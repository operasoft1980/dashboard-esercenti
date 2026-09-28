import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { getStripeOverview } from "@/lib/finance";

export const maxDuration = 60;

/** Situazione pagamenti per ogni cliente Stripe (piano, rinnovo, versato, dovuto, ritardi). */
export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  try {
    const { perCustomer } = await getStripeOverview();
    return NextResponse.json({ perCustomer, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Admin: lettura Stripe non riuscita", err);
    return NextResponse.json({ error: "Stripe non raggiungibile, riprova tra poco." }, { status: 502 });
  }
}
