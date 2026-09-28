import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { saveParametri } from "@/lib/adminSheets";

const num = (v: unknown) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Salva capitale proprio, capitale investito e aliquota imposte stimata. */
export async function POST(req: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  const b = await req.json().catch(() => null);
  const aliquota = num(b?.aliquotaImposte);
  if (aliquota != null && aliquota > 100) {
    return NextResponse.json({ error: "L'aliquota deve essere tra 0 e 100." }, { status: 400 });
  }
  try {
    await saveParametri({
      capitaleProprio: num(b?.capitaleProprio),
      capitaleInvestito: num(b?.capitaleInvestito),
      aliquotaImposte: aliquota,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Parametri: salvataggio non riuscito", err);
    return NextResponse.json({ error: "Salvataggio nel foglio non riuscito." }, { status: 502 });
  }
}
