"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type Cliente = {
  rowNumber: number;
  nomeCliente: string;
  whatsappCliente: string;
  submittedAt: string;
  stato: string;
  dataOraInvio: string;
};

export default function DashboardClient({
  nomeAttivita,
  email,
}: {
  nomeAttivita: string;
  email: string;
}) {
  const router = useRouter();
  const [clients, setClients] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stato, setStato] = useState("");
  const [dataDa, setDataDa] = useState("");
  const [dataA, setDataA] = useState("");

  const loadClients = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (stato) params.set("stato", stato);
    if (dataDa) params.set("dataDa", dataDa);
    if (dataA) params.set("dataA", dataA);
    const res = await fetch(`/api/clients?${params.toString()}`);
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const data = await res.json();
    setClients(data.clients || []);
    setTotal(data.total || 0);
    setLoading(false);
  }, [stato, dataDa, dataA, router]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (stato) params.set("stato", stato);
    if (dataDa) params.set("dataDa", dataDa);
    if (dataA) params.set("dataA", dataA);
    window.location.href = `/api/export?${params.toString()}`;
  }

  const statiUnici = Array.from(new Set(clients.map((c) => c.stato))).filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{nomeAttivita}</h1>
            <p className="text-xs text-gray-500">{email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Esci
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Clienti totali</p>
            <p className="text-2xl font-semibold text-gray-900">{total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500">Risultati filtrati</p>
            <p className="text-2xl font-semibold text-gray-900">{clients.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Stato</label>
            <select
              value={stato}
              onChange={(e) => setStato(e.target.value)}
              className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
            >
              <option value="">Tutti</option>
              {statiUnici.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Da</label>
            <input
              type="date"
              value={dataDa}
              onChange={(e) => setDataDa(e.target.value)}
              className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">A</label>
            <input
              type="date"
              value={dataA}
              onChange={(e) => setDataA(e.target.value)}
              className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
            />
          </div>
          <button
            onClick={handleExport}
            className="ml-auto bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800"
          >
            Scarica Excel
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">WhatsApp</th>
                <th className="text-left px-4 py-3">Registrato il</th>
                <th className="text-left px-4 py-3">Stato</th>
                <th className="text-left px-4 py-3">Invio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Caricamento…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    Nessun cliente trovato
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <tr key={c.rowNumber}>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {c.nomeCliente}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.whatsappCliente}</td>
                    <td className="px-4 py-3 text-gray-600">{c.submittedAt}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          c.stato === "Inviato"
                            ? "bg-green-100 text-green-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {c.stato || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.dataOraInvio || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
