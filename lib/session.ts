import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "esercente_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 giorni

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET mancante o troppo corta (imposta una stringa casuale lunga in Vercel)"
    );
  }
  return new TextEncoder().encode(secret);
}

export type SessionPayload = {
  email: string;
  nomeAttivita: string;
};

export async function createSessionToken(payload: SessionPayload) {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.email === "string" && typeof payload.nomeAttivita === "string") {
      return { email: payload.email, nomeAttivita: payload.nomeAttivita };
    }
    return null;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, SESSION_DURATION_SECONDS };
