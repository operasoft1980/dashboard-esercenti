import { NextRequest, NextResponse } from "next/server";
import { messaggioErroreStripe } from "@/lib/stripe";
import { isAdminRequest } from "@/lib/adminSession";
import { getEsercenteByEmail } from "@/lib/sheets";
import { getSubscriptionInfo, setCancelAtPeriodEnd, descriviPiano } from "@/lib/subscription";

type Esito =
  | { ok: true; customerId: string }
  | { ok: false; error: string; status: number };

async function caricaEsercente(email: string): Promise<Esito> {
  if (!email) return { ok: false, error: "Email mancante", status: 400 };
  const esercente = await getEsercenteByEmail(email);
  if (!esercente) return { ok: false, error: "Esercente non trovato", status: 404 };
  if (!esercente.stripeCustomerId) {
    return { ok: false, error: "Questo esercente non ha un cliente Stripe collegato", status: 404 };
  }
  return { ok: true, customerId: esercente.stripeCustomerId };
}

/** Dettaglio abbonamento live da Stripe per un esercente (admin). */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const email = new URL(req.url).searchParams.get("email") || "";
  const r = await caricaEsercente(email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  try {
    const info = await getSubscriptionInfo(r.customerId);
    return NextResponse.json({ info, piano: descriviPiano(info) });
  } catch (err) {
    console.error("Admin: lettura abbonamento non riuscita", err);
    return NextResponse.json({ error: messaggioErroreStripe(err) }, { status: 502 });
  }
}

/**
 * Azioni di assistenza sull'abbonamento di un esercente:
 * - "disdici": disdetta a fine periodo (nessun rimborso, servizio attivo fino a scadenza)
 * - "riattiva": annulla una disdetta programmata
 */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const azione = body?.azione;
  if (azione !== "disdici" && azione !== "riattiva") {
    return NextResponse.json({ error: "Azione non valida" }, { status: 400 });
  }
  const r = await caricaEsercente(email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  try {
    const info = await setCancelAtPeriodEnd(r.customerId, azione === "disdici");
    console.log(`Admin: abbonamento ${azione} per ${email}`);
    return NextResponse.json({ ok: true, info, piano: descriviPiano(info) });
  } catch (err) {
    console.error("Admin: modifica abbonamento non riuscita", err);
    const msg =
      err instanceof Error && err.message.startsWith("Nessun abbonamento")
        ? err.message
        : messaggioErroreStripe(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
