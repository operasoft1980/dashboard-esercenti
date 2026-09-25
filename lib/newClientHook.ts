/**
 * Chiama il webhook Make "Dashboard - Invia WhatsApp Recensione": lo scenario
 * cerca il link Google Maps dell'esercente e invia il messaggio WhatsApp al
 * cliente. Non tocca il foglio Clienti: l'aggiornamento dello stato a
 * "Inviato" lo fa la dashboard stessa (vedi lib/sheets.ts, markClientiInviati)
 * solo dopo un invio riuscito.
 */

const WEBHOOK_URL =
  process.env.MAKE_INVIA_WHATSAPP_WEBHOOK_URL ||
  "https://hook.eu1.make.com/agnx5chwkhvcja7nk17f6bgv36jmdra4";

export type InviaWhatsAppInput = {
  emailEsercente: string;
  nomeCliente: string;
  whatsappCliente: string;
  submissionId: string;
};

export type InviaWhatsAppResult =
  | { success: true }
  | { success: false; status: number; error: string };

export async function inviaWhatsAppRecensione(
  input: InviaWhatsAppInput
): Promise<InviaWhatsAppResult> {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      // Lo scenario Make risponde solo dopo aver inviato il WhatsApp:
      // può richiedere qualche secondo.
      signal: AbortSignal.timeout(30000),
    });

    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // risposta non JSON: ignoriamo, valutiamo solo lo status
    }

    if (!res.ok) {
      const errMsg =
        (data as { error?: string } | null)?.error ||
        `Il servizio di invio ha risposto con errore (${res.status})`;
      return { success: false, status: res.status, error: errMsg };
    }

    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "TimeoutError"
        ? "Il servizio di invio non ha risposto in tempo. Riprova tra poco."
        : "Impossibile contattare il servizio di invio WhatsApp.";
    return { success: false, status: 502, error: message };
  }
}
