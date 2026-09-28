import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { sheetsClient, getEsercenteByEmail, ESERCENTI_SPREADSHEET_ID, ESERCENTI_SHEET_NAME } from "@/lib/sheets";
import { stripeClient, messaggioErroreStripe } from "@/lib/stripe";
import { normalizzaWhatsapp } from "@/lib/telefono";

/**
 * Manutenzione del foglio "Database Centrale" (solo admin).
 *
 * GET  → intervalli con nome presenti nel foglio (per controllo)
 * POST {azione: "correggiStripe", email, customerId, vecchioId}
 *      Verifica su Stripe che il cliente esista, poi scrive nella riga
 *      dell'esercente il Customer ID e il Subscription ID corretti; se
 *      l'abbonamento su Stripe è cancellato imposta lo stato "Disdetto".
 *      In TokenOnboarding sostituisce il vecchio ID (errato) con quello giusto.
 * POST {azione: "rimuoviNomi", nomi: [...]}
 *      Elimina intervalli con nome creati per errore.
 */
const STATI_VIVI = ["trialing", "active", "past_due", "unpaid", "incomplete"];

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const res = await sheetsClient().spreadsheets.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    fields: "namedRanges",
  });
  return NextResponse.json({ intervalliConNome: (res.data.namedRanges || []).map((n) => ({ id: n.namedRangeId, nome: n.name, range: n.range })) });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const sheets = sheetsClient();

  if (b?.azione === "rimuoviNomi") {
    const nomi: string[] = Array.isArray(b.nomi) ? b.nomi : [];
    const res = await sheets.spreadsheets.get({ spreadsheetId: ESERCENTI_SPREADSHEET_ID, fields: "namedRanges" });
    const daTogliere = (res.data.namedRanges || []).filter((n) => n.name && nomi.includes(n.name));
    if (daTogliere.length) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: ESERCENTI_SPREADSHEET_ID,
        requestBody: { requests: daTogliere.map((n) => ({ deleteNamedRange: { namedRangeId: n.namedRangeId! } })) },
      });
    }
    return NextResponse.json({ ok: true, rimossi: daTogliere.map((n) => n.name) });
  }

  if (b?.azione === "normalizzaWhatsapp") {
    // Stesse regole dello scenario Make "Integration Tally": solo cifre, via
    // lo "00" iniziale, "+39" davanti ai cellulari italiani senza prefisso.
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: ESERCENTI_SPREADSHEET_ID,
      range: `${ESERCENTI_SHEET_NAME}!E2:E10000`,
    });
    const data: { range: string; values: string[][] }[] = [];
    const modifiche: { riga: number; prima: string; dopo: string }[] = [];
    (res.data.values || []).forEach((row, i) => {
      const prima = (row[0] ?? "").toString().trim();
      if (!prima) return;
      const dopo = normalizzaWhatsapp(prima);
      if (dopo && dopo !== prima) {
        data.push({ range: `${ESERCENTI_SHEET_NAME}!E${i + 2}`, values: [[dopo]] });
        modifiche.push({ riga: i + 2, prima, dopo });
      }
    });
    if (data.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: ESERCENTI_SPREADSHEET_ID,
        requestBody: { valueInputOption: "RAW", data },
      });
    }
    return NextResponse.json({ ok: true, modifiche });
  }

  if (b?.azione === "correggiStripe") {
    const email = typeof b.email === "string" ? b.email : "";
    const customerId = typeof b.customerId === "string" ? b.customerId.trim() : "";
    const vecchioId = typeof b.vecchioId === "string" ? b.vecchioId.trim() : "";
    if (!email || !/^cus_[A-Za-z0-9]+$/.test(customerId)) {
      return NextResponse.json({ error: "Email o Customer ID non validi" }, { status: 400 });
    }
    const esercente = await getEsercenteByEmail(email);
    if (!esercente) return NextResponse.json({ error: "Esercente non trovato nel foglio" }, { status: 404 });

    let subId = "";
    let subStatus = "";
    try {
      const stripe = stripeClient();
      const cliente = await stripe.customers.retrieve(customerId);
      if ((cliente as { deleted?: boolean }).deleted) {
        return NextResponse.json({ error: "Il cliente risulta eliminato su Stripe" }, { status: 409 });
      }
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
      const sub = subs.data.find((s) => STATI_VIVI.includes(s.status)) || subs.data[0];
      subId = sub?.id || "";
      subStatus = sub?.status || "";
    } catch (err) {
      return NextResponse.json({ error: messaggioErroreStripe(err) }, { status: 502 });
    }

    const r = esercente.rowNumber;
    const data: { range: string; values: string[][] }[] = [
      { range: `${ESERCENTI_SHEET_NAME}!I${r}:J${r}`, values: [[customerId, subId]] },
    ];
    const cancellato = subStatus === "canceled" || subStatus === "incomplete_expired";
    if (cancellato) data.push({ range: `${ESERCENTI_SHEET_NAME}!H${r}`, values: [["Disdetto"]] });

    // TokenOnboarding: stesso errore di trascrizione nella colonna F
    let tokenCorretti = 0;
    if (vecchioId) {
      const tok = await sheets.spreadsheets.values.get({
        spreadsheetId: ESERCENTI_SPREADSHEET_ID,
        range: "TokenOnboarding!F2:F5000",
      });
      (tok.data.values || []).forEach((row, i) => {
        if ((row[0] || "").toString().trim() === vecchioId) {
          data.push({ range: `TokenOnboarding!F${i + 2}`, values: [[customerId]] });
          tokenCorretti++;
        }
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ESERCENTI_SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data },
    });

    return NextResponse.json({
      ok: true,
      riga: r,
      customerId,
      subscriptionId: subId,
      statoStripe: subStatus,
      statoFoglio: cancellato ? "Disdetto" : esercente.stato,
      tokenCorretti,
    });
  }

  return NextResponse.json({ error: "Azione non valida" }, { status: 400 });
}
