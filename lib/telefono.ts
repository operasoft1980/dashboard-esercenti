/**
 * Numero WhatsApp in formato unico "+39XXXXXXXXXX" (stesse regole dello
 * scenario Make "Integration Tally"): solo cifre, via lo "00" iniziale,
 * "39" davanti ai cellulari italiani scritti senza prefisso.
 */
export function normalizzaWhatsapp(valore: string): string {
  let cifre = valore.replace(/[^0-9]/g, "").replace(/^00/, "");
  if (cifre.length === 10 && cifre.startsWith("3")) cifre = "39" + cifre;
  return cifre ? `+${cifre}` : "";
}
