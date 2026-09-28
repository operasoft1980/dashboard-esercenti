import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getClientsForEsercente, addClienti, STATO_INVIATO } from "@/lib/sheets";
import { applyClientFilters, filtersFromSearchParams } from "@/lib/clientFilters";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const clients = await getClientsForEsercente(session.email);
  const { searchParams } = new URL(req.url);
  const filtered = applyClientFilters(clients, filtersFromSearchParams(searchParams));

  // Riepilogo su TUTTI i clienti dell'esercente (non filtrato): sono i
  // contatori "in tempo reale" in cima alla dashboard.
  const inviati = clients.filter((c) => c.stato === STATO_INVIATO).length;
  const recensioni = clients.filter((c) => c.stelle !== null);
  const sommaStelle = recensioni.reduce((s, c) => s + (c.stelle || 0), 0);
  const summary = {
    totale: clients.length,
    inviati,
    recensiti: recensioni.length,
    positive: recensioni.filter((c) => (c.stelle || 0) >= 4).length,
    mediaStelle: recensioni.length ? sommaStelle / recensioni.length : null,
  };

  return NextResponse.json({ clients: filtered, total: clients.length, summary });
}

/**
 * Aggiunge un singolo cliente alla lista con stato "Non inviato".
 * Non invia alcun messaggio: l'invio è un passo separato (POST /api/clients/send)
 * che l'esercente attiva esplicitamente, selezionando i clienti da inviare.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const nomeCliente = (body?.nomeCliente || "").trim();
  const whatsappCliente = (body?.whatsappCliente || "").trim();

  if (!nomeCliente || !whatsappCliente) {
    return NextResponse.json(
      { error: "Nome e numero WhatsApp sono obbligatori" },
      { status: 400 }
    );
  }

  const [submissionId] = await addClienti(
    session.email,
    [{ nomeCliente, whatsappCliente }],
    "Dashboard - Manuale"
  );

  return NextResponse.json({ success: true, submissionId });
}
