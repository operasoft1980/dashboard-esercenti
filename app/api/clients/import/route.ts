import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { addClienti } from "@/lib/sheets";

type ImportRow = { nomeCliente: string; whatsappCliente: string };

const MAX_ROWS = 500;

/**
 * Aggiunge in blocco i clienti importati da CSV, tutti con stato
 * "Non inviato" e in un'unica scrittura sul foglio. Nessun WhatsApp viene
 * inviato qui: l'esercente li selezionerà e invierà separatamente.
 */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const rows: ImportRow[] = Array.isArray(body?.clients) ? body.clients : [];

  const valid = rows
    .map((r) => ({
      nomeCliente: (r?.nomeCliente || "").trim(),
      whatsappCliente: (r?.whatsappCliente || "").trim(),
    }))
    .filter((r) => r.nomeCliente && r.whatsappCliente);

  if (valid.length === 0) {
    return NextResponse.json({ error: "Nessun cliente valido da importare" }, { status: 400 });
  }
  if (valid.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Puoi importare al massimo ${MAX_ROWS} clienti alla volta` },
      { status: 400 }
    );
  }

  const submissionIds = await addClienti(session.email, valid, "Dashboard - Import CSV");

  return NextResponse.json({ success: true, added: submissionIds.length });
}
