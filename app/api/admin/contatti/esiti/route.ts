import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { aggiornaContatti, getContatti, type Aggiornamento, type StatoContatto } from "@/lib/contatti";
import { brevoConfigurato, eventiProspezione } from "@/lib/brevo";

export const maxDuration = 60;

const ETICHETTE: Record<string, string> = {
  requests: "Inviata",
  delivered: "Consegnata",
  opened: "Aperta",
  loadedByProxy: "Aperta (anteprima automatica)",
  clicks: "Cliccata",
  hardBounces: "Rimbalzata (indirizzo inesistente)",
  softBounces: "Rimbalzata temporaneamente",
  bounces: "Rimbalzata",
  invalid: "Indirizzo non valido",
  blocked: "Bloccata",
  spam: "Segnalata come spam",
  unsubscribed: "Disiscritto",
  deferred: "In ritardo di consegna",
  error: "Errore di invio",
};

// Priorità dello stato mostrato: vince l'evento "più importante".
const RANGO: Record<StatoContatto, number> = {
  Nuovo: 0,
  Errore: 1,
  Inviato: 2,
  Consegnata: 3,
  Aperta: 4,
  Cliccata: 5,
  Rimbalzata: 6,
  Disiscritto: 7,
  Spam: 8,
};

function statoDa(evento: string): StatoContatto | null {
  switch (evento) {
    case "delivered":
      return "Consegnata";
    case "opened":
    case "loadedByProxy":
      return "Aperta";
    case "clicks":
      return "Cliccata";
    case "hardBounces":
    case "bounces":
    case "invalid":
    case "blocked":
      return "Rimbalzata";
    case "spam":
      return "Spam";
    case "unsubscribed":
      return "Disiscritto";
    case "error":
      return "Errore";
    default:
      return null;
  }
}

/** Legge gli esiti da Brevo e aggiorna stato, aperture e clic dei contatti. */
export async function POST() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!brevoConfigurato()) return NextResponse.json({ error: "Manca la chiave Brevo su Vercel." }, { status: 503 });

  let eventi;
  try {
    eventi = await eventiProspezione(90);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Brevo non raggiungibile" }, { status: 502 });
  }
  const contatti = await getContatti();
  const perMessaggio = new Map(contatti.filter((c) => c.messageId).map((c) => [c.messageId, c]));
  const perEmail = new Map(contatti.filter((c) => c.messageId).map((c) => [c.email, c]));

  type Acc = { stato: StatoContatto; aperture: number; clic: number; ultimo: string; data: string };
  const acc = new Map<string, Acc>();
  for (const ev of eventi) {
    const c = perMessaggio.get(ev.messageId) || perEmail.get((ev.email || "").toLowerCase());
    if (!c) continue;
    const a = acc.get(c.id) || { stato: c.stato === "Nuovo" ? "Inviato" : ("Inviato" as StatoContatto), aperture: 0, clic: 0, ultimo: "", data: "" };
    if (ev.event === "opened") a.aperture++;
    if (ev.event === "clicks") a.clic++;
    const s = statoDa(ev.event);
    if (s && RANGO[s] >= RANGO[a.stato]) a.stato = s;
    if (ev.event !== "requests") {
      a.ultimo = ETICHETTE[ev.event] || ev.event;
      a.data = (ev.date || "").replace("T", " ").slice(0, 16);
    }
    acc.set(c.id, a);
  }

  const agg: Aggiornamento[] = [];
  let cambiati = 0;
  for (const c of contatti) {
    const a = acc.get(c.id);
    if (!a) continue;
    // lo stato non torna mai indietro (es. un "Disiscritto" resta tale)
    const stato = RANGO[a.stato] >= RANGO[c.stato] ? a.stato : c.stato;
    const bloccato = c.bloccato || stato === "Spam" || stato === "Disiscritto" || stato === "Rimbalzata";
    if (stato !== c.stato || a.aperture !== c.aperture || a.clic !== c.clic || bloccato !== c.bloccato || (a.ultimo && a.ultimo !== c.ultimoEvento)) {
      cambiati++;
      agg.push({
        riga: c.riga,
        stato,
        aperture: a.aperture,
        clic: a.clic,
        bloccato,
        ...(a.ultimo ? { ultimoEvento: a.ultimo, dataUltimoEvento: a.data } : {}),
      });
    }
  }
  await aggiornaContatti(agg);
  return NextResponse.json({ ok: true, eventi: eventi.length, aggiornati: cambiati });
}
