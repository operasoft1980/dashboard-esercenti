import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getEsercenteByEmail } from "@/lib/sheets";
import { stripeClient } from "@/lib/stripe";

// URL pubblico della dashboard, usato come pagina di ritorno dal Customer
// Portal di Stripe una volta che l'esercente ha confermato (o annullato)
// la disdetta.
const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL || "https://dashboard.recensionia5stelle.it";

/**
 * Genera un link al Customer Portal Stripe dell'esercente loggato, puntando
 * direttamente al flusso di disdetta abbonamento (non alla schermata
 * generale del portale). Stripe applica sempre la disdetta "a fine periodo
 * corrente": l'esercente mantiene l'accesso fino alla scadenza già pagata
 * (mese/trimestre/semestre/anno), poi l'abbonamento semplicemente non si
 * rinnova. Nessun rimborso per il periodo in corso, nessuna penale.
 *
 * NB: questo flusso richiede che nel portale Stripe (Impostazioni ->
 * Portale clienti per la fatturazione) sia abilitata la funzione "Consenti
 * ai clienti di annullare gli abbonamenti".
 */
export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const esercente = await getEsercenteByEmail(session.email);
  if (!esercente || !esercente.stripeCustomerId) {
    return NextResponse.json(
      {
        error:
          "Nessun account di pagamento collegato al tuo profilo. Contatta l'assistenza.",
      },
      { status: 404 }
    );
  }

  try {
    const stripe = stripeClient();

    // Cerchiamo l'abbonamento attivo (o in prova) del cliente: il portale
    // di disdetta ha bisogno dell'ID dell'abbonamento specifico da annullare.
    const subscriptions = await stripe.subscriptions.list({
      customer: esercente.stripeCustomerId,
      status: "all",
      limit: 10,
    });
    const subscription = subscriptions.data.find((s) =>
      ["active", "trialing", "past_due"].includes(s.status)
    );

    if (!subscription) {
      return NextResponse.json(
        { error: "Nessun abbonamento attivo trovato da disdire." },
        { status: 404 }
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: esercente.stripeCustomerId,
      return_url: `${DASHBOARD_URL}/dashboard`,
      flow_data: {
        type: "subscription_cancel",
        subscription_cancel: {
          subscription: subscription.id,
        },
      },
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("Errore creazione sessione di disdetta:", err);
    return NextResponse.json(
      { error: "Impossibile aprire la pagina di disdetta. Riprova più tardi." },
      { status: 500 }
    );
  }
}
