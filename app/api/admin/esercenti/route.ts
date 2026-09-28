import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { getAllEsercenti, getAllClienti, STATO_INVIATO } from "@/lib/sheets";
import { ensureAdminSetup } from "@/lib/adminSheets";

export type EsercenteAdminRow = {
  email: string;
  nomeAttivita: string;
  tipoAttivita: string;
  whatsapp: string;
  dataAttivazione: string;
  stato: string;
  statoPagamento: string;
  dataUltimoPagamento: string;
  dataProssimoRinnovo: string;
  dataUltimoFallimento: string;
  ultimoPromemoria: string;
  numPromemoria: number;
  numSolleciti: number;
  stripeCustomerId: string;
  haStripe: boolean;
  clienti: number;
  inviati: number;
  recensiti: number;
  positive: number;
  sommaStelle: number;
  ultimoCliente: string;
};

/** Elenco completo esercenti con i numeri di utilizzo, solo per l'admin. */
export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }

  // Crea al primo accesso le schede/colonne dell'area admin (costi, contatori promemoria).
  await ensureAdminSetup().catch((err) => console.error("Setup foglio admin non riuscito", err));
  const [esercenti, clienti] = await Promise.all([getAllEsercenti(), getAllClienti()]);

  const perEmail = new Map<string, typeof clienti>();
  for (const c of clienti) {
    if (!c.emailEsercente) continue;
    const list = perEmail.get(c.emailEsercente) || [];
    list.push(c);
    perEmail.set(c.emailEsercente, list);
  }

  const rows: EsercenteAdminRow[] = esercenti.map((e) => {
    const list = perEmail.get(e.email.toLowerCase()) || [];
    const recensioni = list.filter((c) => c.stelle !== null);
    const ultimo = list.reduce((max, c) => (c.submittedAt > max ? c.submittedAt : max), "");
    return {
      email: e.email,
      nomeAttivita: e.nomeAttivita,
      tipoAttivita: e.tipoAttivita,
      whatsapp: e.whatsapp,
      dataAttivazione: e.dataAttivazione,
      stato: e.stato,
      statoPagamento: e.statoPagamento,
      dataUltimoPagamento: e.dataUltimoPagamento,
      dataProssimoRinnovo: e.dataProssimoRinnovo,
      dataUltimoFallimento: e.dataUltimoFallimento,
      ultimoPromemoria: e.ultimoPromemoria,
      numPromemoria: e.numPromemoria,
      numSolleciti: e.numSolleciti,
      stripeCustomerId: e.stripeCustomerId,
      haStripe: !!e.stripeCustomerId,
      clienti: list.length,
      inviati: list.filter((c) => c.stato === STATO_INVIATO).length,
      recensiti: recensioni.length,
      positive: recensioni.filter((c) => (c.stelle || 0) >= 4).length,
      sommaStelle: recensioni.reduce((s, c) => s + (c.stelle || 0), 0),
      ultimoCliente: ultimo,
    };
  });

  return NextResponse.json({ esercenti: rows, generatedAt: new Date().toISOString() });
}
