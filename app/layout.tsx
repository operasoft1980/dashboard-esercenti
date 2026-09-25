import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Recensioni a 5 Stelle — Dashboard",
  description: "Area riservata per gli esercenti abbonati",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
