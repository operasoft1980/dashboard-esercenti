import { NextRequest, NextResponse } from "next/server";
import { authenticateEsercente } from "@/lib/sheets";
import { createSessionToken, COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    const { email, codice } = await req.json();
    if (!email || !codice) {
      return NextResponse.json(
        { error: "Email e codice di accesso sono obbligatori" },
        { status: 400 }
      );
    }

    const esercente = await authenticateEsercente(email, codice);
    if (!esercente) {
      return NextResponse.json(
        { error: "Email o codice di accesso non corretti" },
        { status: 401 }
      );
    }

    const token = await createSessionToken({
      email: esercente.email,
      nomeAttivita: esercente.nomeAttivita,
    });

    const res = NextResponse.json({ ok: true, nomeAttivita: esercente.nomeAttivita });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DURATION_SECONDS,
    });
    return res;
  } catch (err: any) {
    console.error("Login error:", err);
    return NextResponse.json(
      { error: "Errore del server. Riprova tra qualche minuto." },
      { status: 500 }
    );
  }
}
