import type Stripe from "stripe";
import { stripeClient } from "@/lib/stripe";
import { pianoLabel } from "@/lib/subscription";
import { romeMonthKey } from "@/lib/romeTime";
import type { SubLite } from "@/lib/bilancioCalc";

/** Situazione economica di un singolo esercente (cliente Stripe). */
export type CustomerFinance = {
  customerId: string;
  subStatus: string; // trialing | active | past_due | canceled | ...
  piano: string; // Mensile, Trimestrale, ...
  importo: number | null; // euro per periodo
  mrr: number; // euro al mese equivalenti
  prossimoRinnovo: string | null; // ISO
  fineProva: string | null; // ISO
  disdettaProgrammata: boolean;
  fineAccesso: string | null; // ISO
  versato: number; // totale incassato da questo cliente (euro)
  dovuto: number; // fatture aperte non pagate (euro)
  fattureAperte: number;
  tentativiAddebito: number; // tentativi falliti sulla fattura aperta più vecchia
  ritardoDal: string | null; // ISO: data della fattura insoluta più vecchia
};

/** Scorre tutte le pagine di un elenco Stripe, senza limite fisso di righe. */
async function tutti<T>(list: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of list) out.push(x);
  return out;
}

const STATI_VIVI = ["trialing", "active", "past_due", "unpaid", "incomplete"];
const toIso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);
const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : x?.id || "");

function mesiDi(interval: string | undefined, count: number | undefined): number {
  const n = count || 1;
  if (interval === "year") return 12 * n;
  if (interval === "month") return n;
  if (interval === "week") return (n * 7) / 30.44;
  if (interval === "day") return n / 30.44;
  return 1;
}

function mrrDi(sub: Stripe.Subscription): number {
  let tot = 0;
  for (const it of sub.items.data) {
    const p = it.price;
    if (!p?.recurring || p.unit_amount == null) continue;
    tot += ((p.unit_amount / 100) * (it.quantity || 1)) / mesiDi(p.recurring.interval, p.recurring.interval_count);
  }
  return tot;
}

export type StripeOverview = {
  perCustomer: Record<string, CustomerFinance>;
  subs: SubLite[];
};

/** Legge in blocco abbonamenti e fatture da Stripe e li riassume per cliente. */
export async function getStripeOverview(): Promise<StripeOverview> {
  const stripe = stripeClient();
  const [subs, invoices] = await Promise.all([
    tutti(stripe.subscriptions.list({ status: "all", limit: 100 })),
    tutti(stripe.invoices.list({ limit: 100 })),
  ]);

  // Abbonamento di riferimento per cliente: quello ancora "vivo", altrimenti il più recente.
  const subPerCliente = new Map<string, Stripe.Subscription>();
  for (const s of subs) {
    const c = idOf(s.customer);
    const prev = subPerCliente.get(c);
    const vivo = STATI_VIVI.includes(s.status);
    const prevVivo = prev ? STATI_VIVI.includes(prev.status) : false;
    if (!prev || (vivo && !prevVivo) || (vivo === prevVivo && s.created > prev.created)) {
      subPerCliente.set(c, s);
    }
  }

  const perCustomer: Record<string, CustomerFinance> = {};
  const get = (c: string): CustomerFinance => {
    if (!perCustomer[c]) {
      perCustomer[c] = {
        customerId: c,
        subStatus: "",
        piano: "—",
        importo: null,
        mrr: 0,
        prossimoRinnovo: null,
        fineProva: null,
        disdettaProgrammata: false,
        fineAccesso: null,
        versato: 0,
        dovuto: 0,
        fattureAperte: 0,
        tentativiAddebito: 0,
        ritardoDal: null,
      };
    }
    return perCustomer[c];
  };

  for (const [c, s] of subPerCliente) {
    const f = get(c);
    const item = s.items.data[0];
    const rec = item?.price?.recurring;
    f.subStatus = s.status;
    f.piano = pianoLabel(rec?.interval, rec?.interval_count);
    f.importo = item?.price?.unit_amount != null ? item.price.unit_amount / 100 : null;
    f.mrr = mrrDi(s);
    f.prossimoRinnovo = STATI_VIVI.includes(s.status) ? toIso(item?.current_period_end) : null;
    f.fineProva = toIso(s.trial_end);
    f.disdettaProgrammata = s.cancel_at_period_end || !!s.cancel_at;
    f.fineAccesso = toIso(s.cancel_at) || (s.cancel_at_period_end ? toIso(item?.current_period_end) : null) || toIso(s.ended_at);
  }

  const piuVecchia: Record<string, number> = {};
  for (const inv of invoices) {
    const c = idOf(inv.customer);
    if (!c) continue;
    const f = get(c);
    f.versato += (inv.amount_paid || 0) / 100;
    if (inv.status === "open" && (inv.amount_remaining || 0) > 0) {
      f.dovuto += inv.amount_remaining / 100;
      f.fattureAperte += 1;
      if (!piuVecchia[c] || inv.created < piuVecchia[c]) {
        piuVecchia[c] = inv.created;
        f.tentativiAddebito = inv.attempt_count || 0;
        f.ritardoDal = toIso(inv.due_date || inv.created);
      }
    }
  }

  for (const f of Object.values(perCustomer)) {
    f.versato = Math.round(f.versato * 100) / 100;
    f.dovuto = Math.round(f.dovuto * 100) / 100;
    f.mrr = Math.round(f.mrr * 100) / 100;
  }

  const lite: SubLite[] = subs.map((s) => ({
    status: s.status,
    start: s.start_date || s.created,
    endedAt: s.ended_at || null,
    mrr: mrrDi(s),
  }));

  return { perCustomer, subs: lite };
}

export type IncassiPeriodo = {
  lordo: number;
  rimborsi: number;
  commissioni: number;
  perMese: Record<string, { lordo: number; rimborsi: number; commissioni: number }>;
  movimenti: number;
};

/**
 * Movimenti di cassa reali dal saldo Stripe (criterio di cassa): incassi,
 * rimborsi e commissioni Stripe tra due istanti, raggruppati per mese.
 */
export async function getIncassi(daTs: number, aTs: number): Promise<IncassiPeriodo> {
  const stripe = stripeClient();
  const txs = await tutti(stripe.balanceTransactions.list({ created: { gte: daTs, lte: aTs }, limit: 100 }));

  const out: IncassiPeriodo = { lordo: 0, rimborsi: 0, commissioni: 0, perMese: {}, movimenti: 0 };
  for (const t of txs) {
    const mese = romeMonthKey(t.created);
    const m = (out.perMese[mese] ||= { lordo: 0, rimborsi: 0, commissioni: 0 });
    const amount = t.amount / 100;
    const fee = (t.fee || 0) / 100;
    let conta = false;
    if (t.type === "charge" || t.type === "payment") {
      out.lordo += amount;
      m.lordo += amount;
      conta = true;
    } else if (t.type === "refund" || t.type === "payment_refund" || t.type === "payment_failure_refund") {
      out.rimborsi += -amount;
      m.rimborsi += -amount;
      conta = true;
    } else if (t.type === "stripe_fee" || t.type === "tax_fee") {
      // costi di servizio Stripe addebitati a parte (es. Stripe Billing)
      out.commissioni += -amount;
      m.commissioni += -amount;
      conta = true;
    }
    if (fee) {
      out.commissioni += fee;
      m.commissioni += fee;
      conta = true;
    }
    if (conta) out.movimenti++;
  }
  return out;
}
