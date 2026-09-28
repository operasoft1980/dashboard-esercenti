import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { isAdminRequest } from "@/lib/adminSession";
import { stripeClient, messaggioErroreStripe } from "@/lib/stripe";

/**
 * Cambio listino (settembre 2026): nuovi prezzi "a ,90".
 * Stripe non permette di modificare l'importo di un prezzo né il prezzo di
 * un Payment Link: per ogni piano si crea un nuovo prezzo sullo stesso
 * prodotto e un nuovo Payment Link che copia TUTTE le impostazioni del link
 * attuale (prova gratuita, ID fiscali, metodi di pagamento, pagina di ritorno…).
 *
 * GET              → anteprima: link attivi e cosa verrebbe fatto
 * POST {crea}      → crea prezzi e link nuovi (idempotente: se esistono già, li riusa)
 * POST {archivia}  → disattiva i vecchi link e archivia i vecchi prezzi
 */
export const maxDuration = 60;

type Cambio = { nome: string; interval: "month" | "year"; count: number; da: number; a: number };

const CAMBI: Cambio[] = [
  { nome: "Mensile", interval: "month", count: 1, da: 4900, a: 4990 },
  { nome: "Trimestrale", interval: "month", count: 3, da: 13230, a: 12990 },
  { nome: "Annuale", interval: "year", count: 1, da: 47040, a: 46990 },
];

const stessoPiano = (p: Stripe.Price, c: Cambio) =>
  p.recurring?.interval === c.interval && (p.recurring?.interval_count || 1) === c.count;

/** Copia profonda senza null/undefined e senza campi di sola lettura. */
function pulisci(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(pulisci);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (x == null || k === "object" || k === "id") continue;
      const c = pulisci(x);
      if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out;
  }
  return v;
}

function parametriCopia(old: Stripe.PaymentLink, priceId: string, nome: string): Stripe.PaymentLinkCreateParams {
  const sd = old.subscription_data;
  const params: Record<string, unknown> = {
    line_items: [{ price: priceId, quantity: 1 }],
    after_completion: old.after_completion,
    allow_promotion_codes: old.allow_promotion_codes,
    automatic_tax: { enabled: old.automatic_tax?.enabled ?? false },
    billing_address_collection: old.billing_address_collection,
    // "promotions" non è disponibile in Italia: Stripe lo restituisce ma lo rifiuta in creazione.
    consent_collection: old.consent_collection
      ? { ...old.consent_collection, promotions: old.consent_collection.promotions === "auto" ? "auto" : undefined }
      : undefined,
    custom_fields: old.custom_fields?.length ? old.custom_fields : undefined,
    custom_text: old.custom_text,
    payment_method_collection: old.payment_method_collection,
    payment_method_types: old.payment_method_types,
    phone_number_collection: old.phone_number_collection,
    tax_id_collection: old.tax_id_collection,
    restrictions: old.restrictions,
    subscription_data: sd
      ? {
          description: sd.description,
          trial_period_days: sd.trial_period_days,
          trial_settings: sd.trial_settings,
          metadata: sd.metadata,
        }
      : undefined,
    metadata: { ...(old.metadata || {}), piano: nome, listino: "2026-09", sostituisce: old.id },
  };
  if (old.name_collection) params.name_collection = old.name_collection;
  return pulisci(params) as Stripe.PaymentLinkCreateParams;
}

async function statoAttuale() {
  const stripe = stripeClient();
  const links: Stripe.PaymentLink[] = [];
  for await (const l of stripe.paymentLinks.list({ active: true, limit: 100 })) links.push(l);
  const conPrezzo: { link: Stripe.PaymentLink; price: Stripe.Price }[] = [];
  for (const l of links) {
    const items = await stripe.paymentLinks.listLineItems(l.id, { limit: 5, expand: ["data.price"] });
    const price = items.data[0]?.price as Stripe.Price | undefined;
    if (price) conPrezzo.push({ link: l, price });
  }
  return conPrezzo;
}

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  try {
    const attuali = await statoAttuale();
    return NextResponse.json({
      linkAttivi: attuali.map(({ link, price }) => ({
        id: link.id,
        url: link.url,
        prezzo: (price.unit_amount || 0) / 100,
        intervallo: `${price.recurring?.interval_count || 1} ${price.recurring?.interval}`,
        prova: link.subscription_data?.trial_period_days ?? null,
        idFiscali: link.tax_id_collection?.enabled ?? false,
        metodi: link.payment_method_types,
        dopo: link.after_completion,
        metadata: link.metadata,
      })),
      cambi: CAMBI,
    });
  } catch (err) {
    console.error("Listino: lettura non riuscita", err);
    return NextResponse.json({ error: messaggioErroreStripe(err) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const azione = body?.azione;
  const stripe = stripeClient();
  try {
    const attuali = await statoAttuale();

    if (azione === "crea") {
      const risultato = [];
      for (const c of CAMBI) {
        // Link già creato in un giro precedente?
        const giaFatto = attuali.find(({ price }) => stessoPiano(price, c) && price.unit_amount === c.a);
        if (giaFatto) {
          risultato.push({ piano: c.nome, prezzo: c.a / 100, url: giaFatto.link.url, nuovo: false });
          continue;
        }
        const vecchio = attuali.find(({ price }) => stessoPiano(price, c) && price.unit_amount === c.da);
        if (!vecchio) {
          risultato.push({ piano: c.nome, errore: `Nessun link attivo trovato a ${c.da / 100} €` });
          continue;
        }
        const productId = typeof vecchio.price.product === "string" ? vecchio.price.product : vecchio.price.product.id;
        // Prezzo nuovo: riusa se esiste già (attivo) sullo stesso prodotto
        const esistenti = await stripe.prices.list({ product: productId, active: true, limit: 100 });
        let nuovoPrezzo = esistenti.data.find((p) => stessoPiano(p, c) && p.unit_amount === c.a);
        if (!nuovoPrezzo) {
          nuovoPrezzo = await stripe.prices.create({
            product: productId,
            currency: vecchio.price.currency,
            unit_amount: c.a,
            recurring: { interval: c.interval, interval_count: c.count },
            nickname: c.nome,
            tax_behavior: vecchio.price.tax_behavior && vecchio.price.tax_behavior !== "unspecified" ? vecchio.price.tax_behavior : undefined,
            metadata: { listino: "2026-09", sostituisce: vecchio.price.id },
          });
        }
        const link = await stripe.paymentLinks.create(parametriCopia(vecchio.link, nuovoPrezzo.id, c.nome));
        risultato.push({ piano: c.nome, prezzo: c.a / 100, url: link.url, nuovo: true, vecchioLink: vecchio.link.url });
      }
      return NextResponse.json({ ok: true, risultato });
    }

    if (azione === "archivia") {
      const fatti = [];
      for (const c of CAMBI) {
        const nuovo = attuali.find(({ price }) => stessoPiano(price, c) && price.unit_amount === c.a);
        const vecchi = attuali.filter(({ price }) => stessoPiano(price, c) && price.unit_amount === c.da);
        if (!nuovo) {
          fatti.push({ piano: c.nome, errore: "Link nuovo non trovato: non archivio il vecchio" });
          continue;
        }
        const productId = typeof nuovo.price.product === "string" ? nuovo.price.product : nuovo.price.product.id;
        if (c.nome === "Mensile") {
          await stripe.products.update(productId, { default_price: nuovo.price.id });
        }
        for (const v of vecchi) {
          await stripe.paymentLinks.update(v.link.id, { active: false });
          await stripe.prices.update(v.price.id, { active: false });
          fatti.push({ piano: c.nome, disattivato: v.link.url });
        }
      }
      return NextResponse.json({ ok: true, fatti });
    }

    if (azione === "disattivaLink") {
      // Disattiva un singolo link (es. un doppione). I link Stripe non si possono cancellare.
      const id = typeof body?.id === "string" ? body.id : "";
      const trovato = attuali.find(({ link }) => link.id === id);
      if (!trovato) return NextResponse.json({ error: "Link attivo non trovato" }, { status: 404 });
      await stripe.paymentLinks.update(id, { active: false });
      return NextResponse.json({ ok: true, disattivato: trovato.link.url });
    }

    return NextResponse.json({ error: "Azione non valida" }, { status: 400 });
  } catch (err) {
    console.error("Listino: operazione non riuscita", err);
    const msg = err instanceof Error ? err.message : "";
    return NextResponse.json({ error: messaggioErroreStripe(err), dettaglio: msg }, { status: 502 });
  }
}
