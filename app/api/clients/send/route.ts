import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getClientsForEsercente, markClientiInviati, STATO_INVIATO } from "@/lib/sheets";
import { inviaWhatsAppRecensione } from "@/lib/newClientHook";

// Ogni invio è una chiamata sincrona al webhook Make (che manda il WhatsApp
// prima di rispondere): il tempo totale scala con quanti clienti sono
// selezionati, quindi alziamo il timeout della function.
export const maxDuration = 300;

const MAX_PER_REQUEST = 50;
const DELAY_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Invia davvero la richiesta di recensione (WhatsApp) ai clienti selezionati
 * (per submissionId) — passo esplicito, attivato solo dopo conferma
 * dell'esercente. Aggiorna lo stato a "Inviato" solo per chi risulta inviato
 * con successo; i clienti già "Inviato" vengono ignorati (mai reinviati).
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const submissionIds: string[] = Array.isArray(body?.submissionIds) ? body.submissionIds : [];

  if (submissionIds.length === 0) {
    return NextResponse.json({ error: "Nessun cliente selezionato" }, { status: 400 });
  }
  if (submissionIds.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { error: `Puoi inviare al massimo ${MAX_PER_REQUEST} richieste alla volta` },
      { status: 400 }
    );
  }

  // Ricarichiamo i clienti dal foglio per avere nome/whatsapp aggiornati e,
  // soprattutto, per verificare lo stato attuale: chi è già "Inviato" viene
  // escluso qui, così un doppio click o una selezione stantia non rimandano
  // due volte la stessa richiesta allo stesso cliente.
  const clients = await getClientsForEsercente(session.email);
  const bySubmissionId = new Map(clients.map((c) => [c.submissionId, c]));

  const results: Array<{
    submissionId: string;
    nomeCliente: string;
    whatsappCliente: string;
    success: boolean;
    error?: string;
  }> = [];

  const sentSubmissionIds: string[] = [];

  for (let i = 0; i < submissionIds.length; i++) {
    const submissionId = submissionIds[i];
    const client = bySubmissionId.get(submissionId);

    if (!client) {
      results.push({
        submissionId,
        nomeCliente: "",
        whatsappCliente: "",
        success: false,
        error: "Cliente non trovato",
      });
      continue;
    }
    if (client.stato === STATO_INVIATO) {
      results.push({
        submissionId,
        nomeCliente: client.nomeCliente,
        whatsappCliente: client.whatsappCliente,
        success: false,
        error: "Già inviato in precedenza",
      });
      continue;
    }

    const result = await inviaWhatsAppRecensione({
      emailEsercente: session.email,
      nomeCliente: client.nomeCliente,
      whatsappCliente: client.whatsappCliente,
      submissionId: client.submissionId,
    });

    if (result.success) {
      sentSubmissionIds.push(submissionId);
      results.push({
        submissionId,
        nomeCliente: client.nomeCliente,
        whatsappCliente: client.whatsappCliente,
        success: true,
      });
    } else {
      results.push({
        submissionId,
        nomeCliente: client.nomeCliente,
        whatsappCliente: client.whatsappCliente,
        success: false,
        error: result.error,
      });
    }

    if (i < submissionIds.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  if (sentSubmissionIds.length > 0) {
    await markClientiInviati(session.email, sentSubmissionIds);
  }

  const sentCount = results.filter((r) => r.success).length;
  return NextResponse.json({ results, sentCount, failCount: results.length - sentCount });
}
