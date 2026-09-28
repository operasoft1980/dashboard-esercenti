import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_SECONDS,
  adminConfigurato,
  createAdminToken,
  verificaPasswordAdmin,
} from "@/lib/adminSession";

export async function POST(req: NextRequest) {
  if (!adminConfigurato()) {
    return NextResponse.json(
      { error: "Area admin non configurata: manca la variabile ADMIN_PASSWORD su Vercel." },
      { status: 503 }
    );
  }
  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!verificaPasswordAdmin(password)) {
    // piccola attesa contro i tentativi a raffica
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Password non corretta" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, await createAdminToken(), {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
