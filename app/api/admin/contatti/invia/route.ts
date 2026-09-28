import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { aggiornaContatti, getCampagna, getContatti, type Aggiornamento } from "@/lib/contatti";
import { brevoConfigurato, inviaEmail, linkDisiscrizione } from "@/lib/brevo";
import { componiHtml, componiTesto, personalizzaOggetto } from "@/lib/emailProspezione";
import { oggiRomaYmd, romeDateTime } from "@/lib/romeTime";

export const maxDuration = 300;

const MAX_PER_RICHIESTA = 40;
const PAUSA_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Invio email ai contatti selezionati.
 * - {ids: [...]}: invio reale. Si scrive SOLO a contatti mai contattati
 *   ("Nuovo" o "Errore"), non bloccati, entro il limite giornaliero.
 * - {prova: "email", id?: "..."}: invia una copia di prova a un indirizzo
 *   interno, con i dati del contatto indicato (non cambia nulla nell'elenco).
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  if (!brevoConfigurato()) {
    return NextResponse.json({ error: "Manca la chiave Brevo (BREVO_API_KEY) su Vercel." }, { status: 503 });
  }
  const b = await req.json().catch(() => null);
  const [contatti, campagna] = await Promise.all([getContatti(), getCampagna()]);

  if (typeof b?.prova === "string") {
    const dest = b.prova.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest)) return NextResponse.json({ error: "Email di prova non valida" }, { status: 400 });
    const c = contatti.find((x) => x.id === b.id) || contatti[0] || { nome: "Bar Esempio", citta: "Cagliari", tipo: "Bar", voto: 4.3, recensioni: 57 };
    const unsub = linkDisiscrizione(dest);
    try {
      const messageId = await inviaEmail({
        to: dest,
        oggetto: "[PROVA] " + personalizzaOggetto(campagna.oggetto, c),
        html: componiHtml(campagna.corpo, c, unsub),
        testo: componiTesto(campagna.corpo, c, unsub),
        nomeMittente: campagna.nomeMittente,
        tag: "prospezione-prova",
      });
      return NextResponse.json({ ok: true, prova: dest, messageId });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Invio non riuscito" }, { status: 502 });
    }
  }

  const ids: string[] = Array.isArray(b?.ids) ? b.ids : [];
  if (!ids.length) return NextResponse.json({ error: "Nessun contatto selezionato" }, { status: 400 });

  const oggi = oggiRomaYmd();
  const giaOggi = contatti.filter((c) => c.inviato.startsWith(oggi)).length;
  const disponibili = Math.max(0, campagna.limiteGiornaliero - giaOggi);

  const richiesti = contatti.filter((c) => ids.includes(c.id));
  const inviabili = richiesti.filter((c) => !c.bloccato && (c.stato === "Nuovo" || c.stato === "Errore"));
  const saltati = richiesti.length - inviabili.length;
  const lotto = inviabili.slice(0, Math.min(disponibili, MAX_PER_RICHIESTA));
  const rimandati = inviabili.length - lotto.length;

  const esiti: { id: string; nome: string; email: string; ok: boolean; errore?: string }[] = [];
  const agg: Aggiornamento[] = [];
  for (const c of lotto) {
    const unsub = linkDisiscrizione(c.email);
    try {
      const messageId = await inviaEmail({
        to: c.email,
        toName: c.nome,
        oggetto: personalizzaOggetto(campagna.oggetto, c),
        html: componiHtml(campagna.corpo, c, unsub),
        testo: componiTesto(campagna.corpo, c, unsub),
        nomeMittente: campagna.nomeMittente,
      });
      const ora = romeDateTime();
      agg.push({ riga: c.riga, stato: "Inviato", inviato: ora, messageId, ultimoEvento: "Inviata", dataUltimoEvento: ora });
      esiti.push({ id: c.id, nome: c.nome, email: c.email, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Errore";
      agg.push({ riga: c.riga, stato: "Errore", ultimoEvento: `Errore: ${msg}`.slice(0, 120), dataUltimoEvento: romeDateTime() });
      esiti.push({ id: c.id, nome: c.nome, email: c.email, ok: false, errore: msg });
      // chiave o mittente non validi: inutile continuare
      if (/key|unauthori|sender|mittente/i.test(msg)) break;
    }
    await sleep(PAUSA_MS);
  }
  await aggiornaContatti(agg);

  return NextResponse.json({
    ok: true,
    inviati: esiti.filter((e) => e.ok).length,
    errori: esiti.filter((e) => !e.ok).length,
    saltati,
    rimandati,
    limiteRestante: Math.max(0, disponibili - lotto.length),
    esiti,
  });
}
