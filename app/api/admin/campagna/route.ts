import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { CAMPAGNA_DEFAULT, getCampagna, saveCampagna } from "@/lib/contatti";
import { MITTENTE_EMAIL, RISPOSTA_EMAIL } from "@/lib/brevo";

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const campagna = await getCampagna();
  return NextResponse.json({ campagna, predefinita: CAMPAGNA_DEFAULT, mittente: MITTENTE_EMAIL, risposta: RISPOSTA_EMAIL });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const b = await req.json().catch(() => null);
  const oggetto = typeof b?.oggetto === "string" ? b.oggetto.trim().slice(0, 200) : "";
  const corpo = typeof b?.corpo === "string" ? b.corpo.trim().slice(0, 8000) : "";
  const nomeMittente = typeof b?.nomeMittente === "string" ? b.nomeMittente.trim().slice(0, 80) : "";
  const limite = Math.round(Number(b?.limiteGiornaliero));
  if (!oggetto || !corpo || !nomeMittente) {
    return NextResponse.json({ error: "Oggetto, testo e nome mittente sono obbligatori" }, { status: 400 });
  }
  if (!(limite >= 1 && limite <= 280)) {
    return NextResponse.json({ error: "Limite giornaliero tra 1 e 280 (il piano gratuito Brevo ne consente 300 al giorno in tutto)" }, { status: 400 });
  }
  await saveCampagna({ oggetto, corpo, nomeMittente, limiteGiornaliero: limite });
  return NextResponse.json({ ok: true });
}
