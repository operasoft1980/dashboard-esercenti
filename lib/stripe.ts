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

/** Messaggio chiaro per gli errori Stripe più comuni, da mostrare nell'area admin. */
export function messaggioErroreStripe(err: unknown): string {
  const e = err as { type?: string; code?: string; message?: string; raw?: { code?: string } };
  const code = e?.code || e?.raw?.code;
  if (e?.type === "StripeAuthenticationError") {
    return "Chiave Stripe non valida: controlla STRIPE_SECRET_KEY su Vercel.";
  }
  if (e?.type === "StripePermissionError") {
    return "La chiave Stripe non ha i permessi necessari (serve la chiave segreta completa).";
  }
  if (code === "resource_missing" && /customer/i.test(e?.message || "")) {
    return "Cliente non trovato su Stripe con la chiave attuale: probabilmente è stato creato in modalità test e la chiave è live (o viceversa).";
  }
  return "Stripe non raggiungibile, riprova tra poco.";
}
