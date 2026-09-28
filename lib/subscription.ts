import { stripeClient } from "@/lib/stripe";

/**
 * Situazione abbonamento letta in tempo reale da Stripe. Il foglio esercenti
 * resta la fonte per lo stato "Attivo/Disdetto", ma alcune informazioni
 * (disdetta programmata a fine periodo, fine della prova, periodicità del
 * piano) esistono solo su Stripe.
 */
export type SubscriptionInfo = {
  id: string;
  status: string; // trialing | active | past_due | canceled | unpaid | incomplete ...
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null; // ISO
  trialEnd: string | null; // ISO
  periodEnd: string | null; // ISO: prossimo rinnovo o fine accesso se disdetto
  interval: string | null; // month | year
  intervalCount: number | null;
  amount: number | null; // in euro
};

const toIso = (sec: number | null | undefined) =>
  sec ? new Date(sec * 1000).toISOString() : null;

const STATI_VIVI = ["trialing", "active", "past_due", "unpaid", "incomplete"];

async function findSubscription(customerId: string) {
  const stripe = stripeClient();
  const list = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });
  // Preferisce un abbonamento ancora "vivo"; altrimenti l'ultimo (es. cancellato).
  return list.data.find((s) => STATI_VIVI.includes(s.status)) || list.data[0] || null;
}

export async function getSubscriptionInfo(
  customerId: string
): Promise<SubscriptionInfo | null> {
  if (!customerId) return null;
  const sub = await findSubscription(customerId);
  if (!sub) return null;
  const item = sub.items?.data?.[0];
  const price = item?.price;
  return {
    id: sub.id,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    cancelAt: toIso(sub.cancel_at),
    trialEnd: toIso(sub.trial_end),
    periodEnd: toIso(item?.current_period_end),
    interval: price?.recurring?.interval || null,
    intervalCount: price?.recurring?.interval_count || null,
    amount: price?.unit_amount != null ? price.unit_amount / 100 : null,
  };
}

/**
 * Disdetta (true) o riattivazione (false) a fine periodo, lato assistenza.
 * Non annulla mai subito e non genera rimborsi: l'esercente mantiene il
 * servizio fino alla fine del periodo già pagato, esattamente come quando
 * disdice da solo dal Customer Portal.
 */
export async function setCancelAtPeriodEnd(
  customerId: string,
  cancel: boolean
): Promise<SubscriptionInfo | null> {
  const sub = await findSubscription(customerId);
  if (!sub || !STATI_VIVI.includes(sub.status)) {
    throw new Error("Nessun abbonamento attivo trovato su Stripe per questo esercente.");
  }
  const stripe = stripeClient();
  await stripe.subscriptions.update(sub.id, { cancel_at_period_end: cancel });
  return getSubscriptionInfo(customerId);
}

export function pianoLabel(interval: string | null | undefined, count: number | null | undefined): string {
  if (!interval) return "—";
  const n = count || 1;
  if (interval === "year") return n === 1 ? "Annuale" : `Ogni ${n} anni`;
  if (interval === "month") {
    if (n === 1) return "Mensile";
    if (n === 3) return "Trimestrale";
    if (n === 6) return "Semestrale";
    if (n === 12) return "Annuale";
    return `Ogni ${n} mesi`;
  }
  if (interval === "week") return n === 1 ? "Settimanale" : `Ogni ${n} settimane`;
  return interval;
}

export function descriviPiano(info: SubscriptionInfo | null): string {
  return pianoLabel(info?.interval, info?.intervalCount);
}
