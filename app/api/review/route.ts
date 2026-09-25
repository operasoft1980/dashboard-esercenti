import { NextRequest, NextResponse } from "next/server";
import { getClienteBySubmissionId, salvaRecensione } from "@/lib/sheets";

// Solo dalla 4a stella in su la recensione viene girata a Google Maps
// (ufficiale). Da 1 a 3 stelle resta privata: salvata per l'esercente, mai
// pubblicata.
const SOGLIA_STELLE_GOOGLE = 4;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const submissionId: string = typeof body?.submissionId === "string" ? body.submissionId : "";
  const stelle: number = Number(body?.stelle);
  const commento: string = typeof body?.commento === "string" ? body.commento.trim().slice(0, 1000) : "";

  if (!submissionId || !Number.isInteger(stelle) || stelle < 1 || stelle > 5) {
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  }

  const cliente = await getClienteBySubmissionId(submissionId);
  if (!cliente) {
    return NextResponse.json({ error: "Link non valido" }, { status: 404 });
  }
  if (cliente.giaRecensito) {
    return NextResponse.json({ error: "Hai già inviato una recensione con questo link" }, { status: 409 });
  }

  const salvato = await salvaRecensione(submissionId, stelle, commento);
  if (!salvato) {
    return NextResponse.json({ error: "Impossibile salvare la recensione, riprova" }, { status: 500 });
  }

  const inviaAGoogle = stelle >= SOGLIA_STELLE_GOOGLE && !!cliente.linkGoogleMapsEsercente;

  return NextResponse.json({
    success: true,
    redirectUrl: inviaAGoogle ? cliente.linkGoogleMapsEsercente : null,
  });
}
