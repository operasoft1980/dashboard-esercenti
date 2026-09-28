import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { getIncassi, getStripeOverview } from "@/lib/finance";
import { getCosti, getParametri } from "@/lib/adminSheets";
import {
  contoEconomico,
  giorniTra,
  mesiTra,
  metricheAbbonamenti,
  occorrenzeCosti,
} from "@/lib/bilancioCalc";
import { oggiRomaYmd, romeDayEnd, romeDayStart } from "@/lib/romeTime";

export const maxDuration = 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Bilancino di un periodo: incassi Stripe, costi, utile, indici e metriche abbonamenti. */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const da = sp.get("da") || "";
  const a = sp.get("a") || "";
  if (!YMD.test(da) || !YMD.test(a) || da > a) {
    return NextResponse.json({ error: "Periodo non valido" }, { status: 400 });
  }

  const daTs = romeDayStart(da);
  const aTs = romeDayEnd(a);
  const oggi = oggiRomaYmd();

  let incassi, overview;
  try {
    [incassi, overview] = await Promise.all([getIncassi(daTs, aTs), getStripeOverview()]);
  } catch (err) {
    console.error("Bilancio: Stripe non raggiungibile", err);
    return NextResponse.json({ error: "Stripe non raggiungibile, riprova tra poco." }, { status: 502 });
  }

  let costi, parametri;
  try {
    [costi, parametri] = await Promise.all([getCosti(), getParametri()]);
  } catch (err) {
    console.error("Bilancio: foglio costi non leggibile", err);
    return NextResponse.json(
      { error: "Impossibile leggere costi e parametri dal foglio Database Centrale." },
      { status: 502 }
    );
  }

  const occorrenze = occorrenzeCosti(costi, da, a, oggi);
  const totCosti = occorrenze.reduce((t, o) => t + o.importo, 0);
  // Per gli indici annualizzati contano solo i giorni già trascorsi del periodo.
  const fineEffettiva = a < oggi ? a : oggi;
  const giorni = fineEffettiva >= da ? giorniTra(da, fineEffettiva) : 0;
  const conto = contoEconomico(incassi, totCosti, parametri, giorni);

  const perMese = mesiTra(da, a).map((mese) => {
    const inc = incassi.perMese[mese] || { lordo: 0, rimborsi: 0, commissioni: 0 };
    const c = occorrenze.filter((o) => o.data.startsWith(mese)).reduce((t, o) => t + o.importo, 0);
    const ce = contoEconomico(inc, c, { ...parametri }, 30);
    return {
      mese,
      ricaviNetti: ce.ricaviNetti,
      commissioni: ce.commissioni,
      costi: ce.costi,
      utileAnteImposte: ce.utileAnteImposte,
      utileNetto: ce.utileNetto,
    };
  });

  const perCategoria: Record<string, number> = {};
  for (const o of occorrenze) {
    perCategoria[o.categoria || "Altro"] = (perCategoria[o.categoria || "Altro"] || 0) + o.importo;
  }

  const crediti = Object.values(overview.perCustomer).reduce((t, f) => t + f.dovuto, 0);

  return NextResponse.json({
    periodo: { da, a, giorni, oggi },
    conto,
    perMese,
    perCategoria,
    occorrenze,
    costi,
    parametri,
    abbonamenti: metricheAbbonamenti(overview.subs, daTs, aTs),
    creditiInsoluti: Math.round(crediti * 100) / 100,
    movimenti: incassi.movimenti,
  });
}
