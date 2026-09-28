const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function euro(n: number | null | undefined, decimali = true): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (decimali ? eur : eur0).format(n || 0); // evita "-0,00 €"
}

export function percento(v: number | null | undefined, decimali = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(decimali).replace(".", ",")}%`;
}
