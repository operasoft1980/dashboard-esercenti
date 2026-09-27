import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getEsercenteByEmail } from "@/lib/sheets";
import { stripeClient } from "@/lib/stripe";

// URL pubblico della dashboard, usato come pagina di ritorno dal Customer
// Portal di Stripe una volta che l'esercente ha aggiornato la carta o
// riattivato l'abbonamento.
const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL || "https://dashboard.recensionia5stelle.it";

/**
 * Genera un link temporaneo al Customer Portal Stripe dell'esercente
 * loggato, per permettergli di aggiornare il metodo di pagamento o
 * riattivare l'abbonamento dopo una disdetta/pagamento fallito. Il portale
 * è gestito interamente da Stripe: qui ci limitiamo a crearne una sessione
 * legata al suo Stripe Customer ID (letto dal foglio, colonna I).
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
    const portalSession = await stripeClient().billingPortal.sessions.create({
      customer: esercente.stripeCustomerId,
      return_url: `${DASHBOARD_URL}/dashboard`,
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (err) {
    console.error("Errore creazione sessione Customer Portal:", err);
    return NextResponse.json(
      { error: "Impossibile aprire la pagina di pagamento. Riprova più tardi." },
      { status: 500 }
    );
  }
}
