import { SignJWT, jwtVerify } from "jose";
import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/**
 * Accesso all'area admin: una sola password, letta dalla variabile
 * d'ambiente ADMIN_PASSWORD (da impostare su Vercel). Sessione separata da
 * quella degli esercenti, con cookie e durata propri.
 */
export const ADMIN_COOKIE_NAME = "admin_session";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 12; // 12 ore

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET mancante o troppo corta");
  }
  return new TextEncoder().encode(secret);
}

export function adminConfigurato(): boolean {
  return (process.env.ADMIN_PASSWORD || "").length >= 8;
}

export function verificaPasswordAdmin(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (expected.length < 8) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function createAdminToken() {
  return await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_SECONDS}s`)
    .sign(getSecret());
}

export async function isAdminRequest(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}
