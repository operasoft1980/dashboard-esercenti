"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";

type Cliente = {
  rowNumber: number;
  submissionId: string;
  nomeCliente: string;
  whatsappCliente: string;
  submittedAt: string;
  stato: string;
  dataOraInvio: string;
};

type ImportRow = {
  nomeCliente: string;
  whatsappCliente: string;
  error?: string;
};

type SendResultRow = {
  submissionId: string;
  nomeCliente: string;
  whatsappCliente: string;
  success: boolean;
  error?: string;
};

const STATO_INVIATO = "Inviato";

/** Parsing CSV minimale: rileva il separatore (";" o ","), salta un'eventuale
 * riga di intestazione, e legge le prime due colonne come Nome e WhatsApp. */
function parseClientsCsv(text: string): ImportRow[] {
  const lines = text
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const delimiter =
    (lines[0].match(/;/g)?.length || 0) >= (lines[0].match(/,/g)?.length || 0) ? ";" : ",";

  const splitLine = (line: string) =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));

  let dataLines = lines;
  const firstCells = splitLine(lines[0]).join(" ").toLowerCase();
  if (firstCells.includes("nome") || firstCells.includes("whatsapp") || firstCells.includes("telefono")) {
    dataLines = lines.slice(1);
  }

  return dataLines.map((line) => {
    const cells = splitLine(line);
    const nomeCliente = cells[0] || "";
    const whatsappCliente = cells[1] || "";
    let error: string | undefined;
    if (!nomeCliente || !whatsappCliente) {
      error = "Nome o numero WhatsApp mancante";
    } else if (!/^\+?[0-9\s]{6,}$/.test(whatsappCliente)) {
      error = "Numero WhatsApp non valido";
    }
    return { nomeCliente, whatsappCliente, error };
  });
}

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // --- Aggiunta singolo cliente ---
  const [showAddModal, setShowAddModal] = useState(false);
  const [addNome, setAddNome] = useState("");
  const [addWhatsapp, setAddWhatsapp] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState("");

  // --- Import CSV ---
  const [showImportModal, setShowImportModal] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importStep, setImportStep] = useState<"pick" | "review" | "saving">("pick");
  const [importError, setImportError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Invio richieste selezionate ---
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendStep, setSendStep] = useState<"confirm" | "sending" | "done">("confirm");
  const [sendResults, setSendResults] = useState<SendResultRow[]>([]);

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

  // Le selezioni non hanno più senso se cambiano i filtri: le puliamo quando
  // l'esercente cambia un filtro (non in un effect, per evitare render a cascata).
  function updateStato(value: string) {
    setStato(value);
    setSelected(new Set());
  }
  function updateDataDa(value: string) {
    setDataDa(value);
    setSelected(new Set());
  }
  function updateDataA(value: string) {
    setDataA(value);
    setSelected(new Set());
  }

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
  const selezionabili = useMemo(() => clients.filter((c) => c.stato !== STATO_INVIATO), [clients]);
  const tuttiSelezionati =
    selezionabili.length > 0 && selezionabili.every((c) => selected.has(c.submissionId));

  function toggleSelect(submissionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(submissionId)) next.delete(submissionId);
      else next.add(submissionId);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(tuttiSelezionati ? new Set() : new Set(selezionabili.map((c) => c.submissionId)));
  }

  function rowColorClass(c: Cliente) {
    if (c.stato === STATO_INVIATO) return "bg-green-50";
    return "bg-red-50";
  }

  function statoBadgeClass(s: string) {
    if (s === STATO_INVIATO) return "bg-green-100 text-green-700";
    return "bg-red-100 text-red-700";
  }

  // --- Handlers: aggiunta singolo cliente ---
  function openAddModal() {
    setAddNome("");
    setAddWhatsapp("");
    setAddError("");
    setShowAddModal(true);
  }

  async function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!addNome.trim() || !addWhatsapp.trim()) {
      setAddError("Inserisci nome e numero WhatsApp.");
      return;
    }
    setAddSubmitting(true);
    setAddError("");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomeCliente: addNome.trim(), whatsappCliente: addWhatsapp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "Aggiunta non riuscita, riprova.");
        setAddSubmitting(false);
        return;
      }
      setShowAddModal(false);
      setAddSubmitting(false);
      loadClients();
    } catch {
      setAddError("Errore di rete, riprova.");
      setAddSubmitting(false);
    }
  }

  // --- Handlers: import CSV ---
  function openImportModal() {
    setImportRows([]);
    setImportError("");
    setImportStep("pick");
    setShowImportModal(true);
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const rows = parseClientsCsv(text);
      setImportRows(rows);
      setImportStep("review");
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function updateImportRow(index: number, field: "nomeCliente" | "whatsappCliente", value: string) {
    setImportRows((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      const row = next[index];
      next[index].error =
        !row.nomeCliente || !row.whatsappCliente
          ? "Nome o numero WhatsApp mancante"
          : !/^\+?[0-9\s]{6,}$/.test(row.whatsappCliente)
          ? "Numero WhatsApp non valido"
          : undefined;
      return next;
    });
  }

  function removeImportRow(index: number) {
    setImportRows((prev) => prev.filter((_, i) => i !== index));
  }

  const validImportRows = importRows.filter((r) => !r.error);

  async function handleImportConfirm() {
    setImportStep("saving");
    setImportError("");
    try {
      const res = await fetch("/api/clients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clients: validImportRows.map((r) => ({
            nomeCliente: r.nomeCliente,
            whatsappCliente: r.whatsappCliente,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || "Importazione non riuscita.");
        setImportStep("review");
        return;
      }
      setShowImportModal(false);
      loadClients();
    } catch {
      setImportError("Errore di rete, riprova.");
      setImportStep("review");
    }
  }

  // --- Handlers: invio richieste selezionate ---
  function openSendModal() {
    setSendStep("confirm");
    setSendResults([]);
    setShowSendModal(true);
  }

  const clientiDaInviare = clients.filter((c) => selected.has(c.submissionId));

  async function handleSendConfirm() {
    setSendStep("sending");
    try {
      const res = await fetch("/api/clients/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: Array.from(selected) }),
      });
      const data = await res.json();
      setSendResults(data.results || []);
      setSendStep("done");
      setSelected(new Set());
      loadClients();
    } catch {
      setSendResults(
        clientiDaInviare.map((c) => ({
          submissionId: c.submissionId,
          nomeCliente: c.nomeCliente,
          whatsappCliente: c.whatsappCliente,
          success: false,
          error: "Errore di rete",
        }))
      );
      setSendStep("done");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{nomeAttivita}</h1>
            <p className="text-xs text-gray-500">{email}</p>
          </div>
          <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-900">
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
              onChange={(e) => updateStato(e.target.value)}
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
              onChange={(e) => updateDataDa(e.target.value)}
              className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">A</label>
            <input
              type="date"
              value={dataA}
              onChange={(e) => updateDataA(e.target.value)}
              className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={openImportModal}
              className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-4 py-2 hover:bg-gray-50"
            >
              Importa CSV
            </button>
            <button
              onClick={openAddModal}
              className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-4 py-2 hover:bg-gray-50"
            >
              + Aggiungi cliente
            </button>
            <button
              onClick={handleExport}
              className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800"
            >
              Scarica Excel
            </button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-700">
              <b>{selected.size}</b> client{selected.size === 1 ? "e" : "i"} selezionat
              {selected.size === 1 ? "o" : "i"}
            </p>
            <button
              onClick={openSendModal}
              className="bg-green-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-green-700"
            >
              Invia richiesta recensione
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={tuttiSelezionati}
                    onChange={toggleSelectAll}
                    disabled={selezionabili.length === 0}
                    title="Seleziona tutti (solo non inviati)"
                  />
                </th>
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
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Caricamento…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Nessun cliente trovato
                  </td>
                </tr>
              ) : (
                clients.map((c) => {
                  const inviato = c.stato === STATO_INVIATO;
                  return (
                    <tr key={c.rowNumber} className={rowColorClass(c)}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(c.submissionId)}
                          disabled={inviato}
                          onChange={() => toggleSelect(c.submissionId)}
                          title={inviato ? "Già inviato: non selezionabile" : ""}
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{c.nomeCliente}</td>
                      <td className="px-4 py-3 text-gray-600">{c.whatsappCliente}</td>
                      <td className="px-4 py-3 text-gray-600">{c.submittedAt}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statoBadgeClass(
                            c.stato
                          )}`}
                        >
                          {c.stato || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{c.dataOraInvio || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* --- Modale: aggiungi singolo cliente --- */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-sm w-full p-5">
            <form onSubmit={handleAddSubmit}>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Aggiungi cliente</h2>
              <p className="text-xs text-gray-500 mb-4">
                Il cliente entra in lista con stato &quot;Non inviato&quot;. La richiesta di recensione
                non parte da qui: selezionalo in tabella e conferma l&apos;invio quando vuoi.
              </p>
              <label className="block text-xs text-gray-500 mb-1">Nome cliente</label>
              <input
                autoFocus
                value={addNome}
                onChange={(e) => setAddNome(e.target.value)}
                className="w-full rounded-lg border border-gray-300 text-sm px-3 py-2 mb-3"
                placeholder="Es. Mario Rossi"
              />
              <label className="block text-xs text-gray-500 mb-1">Numero WhatsApp</label>
              <input
                value={addWhatsapp}
                onChange={(e) => setAddWhatsapp(e.target.value)}
                className="w-full rounded-lg border border-gray-300 text-sm px-3 py-2 mb-1"
                placeholder="+39 333 1234567"
              />
              {addError && <p className="text-xs text-red-600 mt-1 mb-2">{addError}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="text-sm text-gray-500 px-3 py-2 hover:text-gray-900"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={addSubmitting}
                  className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-60"
                >
                  {addSubmitting ? "Aggiunta…" : "Aggiungi alla lista"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Modale: import CSV --- */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-2xl w-full p-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">Importa clienti da CSV</h2>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-sm text-gray-400 hover:text-gray-700"
              >
                ✕
              </button>
            </div>

            {importStep === "pick" && (
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Carica un file CSV con due colonne: <b>Nome</b> e <b>WhatsApp</b> (con o senza riga di
                  intestazione). I clienti entrano in lista come &quot;Non inviato&quot;: l&apos;invio lo
                  farai dopo, selezionandoli in tabella.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileSelected}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:text-white file:px-4 file:py-2 file:text-sm"
                />
              </div>
            )}

            {(importStep === "review" || importStep === "saving") && (
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Controlla i dati prima di aggiungerli alla lista. Le righe con errori (evidenziate) non
                  verranno importate.
                </p>
                <div className="border border-gray-200 rounded-lg overflow-hidden mb-3">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Nome</th>
                        <th className="text-left px-3 py-2">WhatsApp</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {importRows.map((row, i) => (
                        <tr key={i} className={row.error ? "bg-red-50" : ""}>
                          <td className="px-3 py-1.5">
                            <input
                              value={row.nomeCliente}
                              onChange={(e) => updateImportRow(i, "nomeCliente", e.target.value)}
                              className="w-full rounded border border-gray-300 text-sm px-2 py-1"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              value={row.whatsappCliente}
                              onChange={(e) => updateImportRow(i, "whatsappCliente", e.target.value)}
                              className="w-full rounded border border-gray-300 text-sm px-2 py-1"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              onClick={() => removeImportRow(i)}
                              className="text-xs text-gray-400 hover:text-red-600"
                            >
                              Rimuovi
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  {validImportRows.length} clienti pronti su {importRows.length} righe.
                </p>
                {importError && <p className="text-xs text-red-600 mb-2">{importError}</p>}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setImportStep("pick")}
                    disabled={importStep === "saving"}
                    className="text-sm text-gray-500 px-3 py-2 hover:text-gray-900"
                  >
                    Indietro
                  </button>
                  <button
                    onClick={handleImportConfirm}
                    disabled={validImportRows.length === 0 || importStep === "saving"}
                    className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50"
                  >
                    {importStep === "saving"
                      ? "Aggiunta…"
                      : `Aggiungi ${validImportRows.length} client${validImportRows.length === 1 ? "e" : "i"} alla lista`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Modale: conferma invio richieste --- */}
      {showSendModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto">
            {sendStep === "confirm" && (
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">Vuoi inviare?</h2>
                <p className="text-xs text-gray-500 mb-4">
                  Verrà inviato subito un messaggio WhatsApp con la richiesta di recensione a questi{" "}
                  {clientiDaInviare.length} client{clientiDaInviare.length === 1 ? "e" : "i"}. Controlla i
                  numeri prima di confermare: una volta inviato, non sarà più possibile reinviare allo
                  stesso cliente da qui.
                </p>
                <div className="border border-gray-200 rounded-lg overflow-hidden mb-4 max-h-56 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Nome</th>
                        <th className="text-left px-3 py-2">WhatsApp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {clientiDaInviare.map((c) => (
                        <tr key={c.submissionId}>
                          <td className="px-3 py-1.5">{c.nomeCliente}</td>
                          <td className="px-3 py-1.5">{c.whatsappCliente}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setShowSendModal(false)}
                    className="text-sm text-gray-500 px-3 py-2 hover:text-gray-900"
                  >
                    Annulla
                  </button>
                  <button
                    onClick={handleSendConfirm}
                    className="bg-green-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-green-700"
                  >
                    Conferma e invia
                  </button>
                </div>
              </div>
            )}

            {sendStep === "sending" && (
              <div className="py-8 text-center text-sm text-gray-500">
                Invio in corso, uno alla volta… non chiudere questa finestra.
              </div>
            )}

            {sendStep === "done" && (
              <div>
                <p className="text-sm text-gray-700 mb-3">
                  Inviati con successo: <b>{sendResults.filter((r) => r.success).length}</b> /{" "}
                  {sendResults.length}
                </p>
                <div className="border border-gray-200 rounded-lg overflow-hidden mb-3 max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Nome</th>
                        <th className="text-left px-3 py-2">WhatsApp</th>
                        <th className="text-left px-3 py-2">Esito</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sendResults.map((r) => (
                        <tr key={r.submissionId}>
                          <td className="px-3 py-1.5">{r.nomeCliente}</td>
                          <td className="px-3 py-1.5">{r.whatsappCliente}</td>
                          <td className="px-3 py-1.5">
                            {r.success ? (
                              <span className="text-green-700">Inviato</span>
                            ) : (
                              <span className="text-red-600">{r.error || "Errore"}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowSendModal(false)}
                    className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800"
                  >
                    Chiudi
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
