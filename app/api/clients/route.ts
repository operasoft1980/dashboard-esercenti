import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getClientsForEsercente, addClienti } from "@/lib/sheets";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const clients = await getClientsForEsercente(session.email);

  const { searchParams } = new URL(req.url);
  const stato = searchParams.get("stato");
  const dataDa = searchParams.get("dataDa");
  const dataA = searchParams.get("dataA");

  let filtered = clients;
  if (stato) {
    filtered = filtered.filter((c) => c.stato === stato);
  }
  if (dataDa) {
    filtered = filtered.filter((c) => c.submittedAt >= dataDa);
  }
  if (dataA) {
    filtered = filtered.filter((c) => c.submittedAt <= dataA);
  }

  return NextResponse.json({ clients: filtered, total: clients.length });
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
