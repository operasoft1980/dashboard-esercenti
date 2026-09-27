import Stripe from "stripe";

let cachedClient: Stripe | null = null;

/**
 * Client Stripe condiviso, inizializzato al primo utilizzo. Richiede
 * STRIPE_SECRET_KEY tra le variabili d'ambiente (chiave segreta live o
 * test a seconda dell'ambiente Vercel).
 */
export function stripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY mancante: impostala nelle variabili d'ambiente del progetto"
    );
  }
  cachedClient = new Stripe(secretKey);
  return cachedClient;
}
