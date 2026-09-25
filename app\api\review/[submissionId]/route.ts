import { NextRequest, NextResponse } from "next/server";
import { getClienteBySubmissionId } from "@/lib/sheets";

/**
 * Dati pubblici per la pagina di recensione: nessuna autenticazione, il
 * submissionId nel link WhatsApp è di per sé la "chiave" (non enumerabile,
 * generato con randomUUID). Non espone email o dati sensibili dell'esercente.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ submissionId: string }> }
) {
  const { submissionId } = await params;
  const cliente = await getClienteBySubmissionId(submissionId);

  if (!cliente) {
    return NextResponse.json({ error: "Link non valido" }, { status: 404 });
  }

  return NextResponse.json({
    nomeCliente: cliente.nomeCliente,
    nomeAttivitaEsercente: cliente.nomeAttivitaEsercente,
    giaRecensito: cliente.giaRecensito,
  });
}

