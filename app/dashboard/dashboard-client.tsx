"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { FILTRI_STELLE } from "@/lib/clientFilters";
import { formatDataIt, giorniDaOggi } from "@/lib/dates";

export type AbbonamentoView = {
  stato: string;
  statoPagamento: string;
  dataUltimoPagamento: string;
  dataProssimoRinnovo: string;
  dataUltimoFallimento: string;
  piano: string;
  importo: number | null;
  stripeStatus: string;
  inProva: boolean;
  fineProva: string | null;
  disdettaProgrammata: boolean;
  fineAccesso: string | null;
  prossimoRinnovoStripe: string | null;
};

type Summary = {
  totale: number;
  inviati: number;
  recensiti: number;
  positive: number;
  mediaStelle: number | null;
};

const REFRESH_MS = 60_000;

type Cliente = {
  rowNumber: number;
  submissionId: string;
  nomeCliente: string;
  whatsappCliente: string;
  submittedAt: string;
  stato: string;
  dataOraInvio: string;
  stelle: number | null;
  commento: string;
  dataRecensione: string;
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
  abbonamentoAttivo,
  abbonamento,
}: {
  nomeAttivita: string;
  email: string;
  abbonamentoAttivo: boolean;
  abbonamento: AbbonamentoView;
}) {
  const router = useRouter();
  const [clients, setClients] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stato, setStato] = useState("");
  const [dataDa, setDataDa] = useState("");
  const [dataA, setDataA] = useState("");
  const [stelle, setStelle] = useState("");
  const [cercaInput, setCercaInput] = useState("");
  const [cerca, setCerca] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [exporting, setExporting] = useState<"" | "xlsx" | "pdf">("");

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
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState("");

  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (stato) params.set("stato", stato);
    if (dataDa) params.set("dataDa", dataDa);
    if (dataA) params.set("dataA", dataA);
    if (stelle) params.set("stelle", stelle);
    if (cerca) params.set("cerca", cerca);
    return params;
  }, [stato, dataDa, dataA, stelle, cerca]);

  // silent = aggiornamento automatico in background: niente "Caricamento…"
  // e la selezione resta (tolti solo i clienti non più presenti).
  const loadClients = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch(`/api/clients?${filterParams().toString()}`, { cache: "no-store" });
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const data = await res.json();
        const nuovi: Cliente[] = data.clients || [];
        setClients(nuovi);
        setTotal(data.total || 0);
        setSummary(data.summary || null);
        setLastUpdated(new Date());
        if (silent) {
          const ids = new Set(nuovi.map((c) => c.submissionId));
          setSelected((prev) => new Set(Array.from(prev).filter((id) => ids.has(id))));
        }
      } catch {
        // rete assente: si riprova al prossimo giro
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filterParams, router]
  );

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // Aggiornamento automatico: ogni minuto, e subito quando si torna sulla scheda.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") loadClients(true);
    };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [loadClients]);

  // Ricerca per nome/numero: parte 400 ms dopo l'ultima lettera digitata.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (cercaInput.trim() !== cerca) {
        setCerca(cercaInput.trim());
        setSelected(new Set());
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [cercaInput, cerca]);

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
  function updateStelle(value: string) {
    setStelle(value);
    setSelected(new Set());
  }
  function resetFiltri() {
    setStato("");
    setDataDa("");
    setDataA("");
    setStelle("");
    setCercaInput("");
    setCerca("");
    setSelected(new Set());
  }
  const filtriAttivi = !!(stato || dataDa || dataA || stelle || cerca);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleRinnovaPagamento() {
    setPortalError("");
    setPortalLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setPortalError(data.error || "Impossibile aprire la pagina di pagamento.");
        setPortalLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setPortalError("Errore di rete. Riprova.");
      setPortalLoading(false);
    }
  }

  async function handleDisdici() {
    const confermato = window.confirm(
      "Vuoi disdire l'abbonamento?\n\n" +
        "Il servizio resterà attivo fino alla fine del periodo già pagato " +
        "(non verrà addebitato nulla in più e non ci sono penali, ma non " +
        "c'è rimborso per il periodo in corso). Dopo la scadenza, " +
        "l'abbonamento non si rinnoverà più.\n\n" +
        "Nella pagina successiva potrai confermare la disdetta."
    );
    if (!confermato) return;

    setCancelError("");
    setCancelLoading(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setCancelError(data.error || "Impossibile aprire la pagina di disdetta.");
        setCancelLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setCancelError("Errore di rete. Riprova.");
      setCancelLoading(false);
    }
  }

  // Righe da esportare: i selezionati se ce ne sono, altrimenti tutto
  // l'elenco filtrato mostrato a video.
  const righeExport = useMemo(
    () => (selected.size > 0 ? clients.filter((c) => selected.has(c.submissionId)) : clients),
    [clients, selected]
  );

  function scaricaBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const baseFileName = `clienti_${nomeAttivita.replace(/[^a-z0-9]/gi, "_")}`;

  async function handleExportExcel() {
    if (righeExport.length === 0) return;
    setExporting("xlsx");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionIds: righeExport.map((c) => c.submissionId),
        }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) throw new Error();
      scaricaBlob(await res.blob(), `${baseFileName}.xlsx`);
    } catch {
      alert("Download Excel non riuscito, riprova.");
    } finally {
      setExporting("");
    }
  }

  async function handleExportPdf() {
    if (righeExport.length === 0) return;
    setExporting("pdf");
    try {
      const [{ jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
      ]);
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      doc.setFontSize(14);
      doc.text(`${nomeAttivita} - Elenco clienti`, 14, 15);
      doc.setFontSize(9);
      doc.setTextColor(100);
      const descr: string[] = [];
      if (selected.size > 0) descr.push(`${selected.size} selezionati`);
      else {
        if (stato) descr.push(`Stato: ${stato}`);
        if (stelle) descr.push(`Recensione: ${FILTRI_STELLE.find((f) => f.value === stelle)?.label || stelle}`);
        if (dataDa) descr.push(`Da: ${formatDataIt(dataDa)}`);
        if (dataA) descr.push(`A: ${formatDataIt(dataA)}`);
        if (cerca) descr.push(`Ricerca: "${cerca}"`);
      }
      doc.text(
        `Generato il ${formatDataIt(new Date(), true)} - ${righeExport.length} clienti` +
          (descr.length ? ` - ${descr.join(" - ")}` : ""),
        14,
        21
      );
      autoTable(doc, {
        startY: 26,
        head: [["Cliente", "WhatsApp", "Registrato", "Stato", "Invio", "Stelle", "Commento", "Recensito il"]],
        body: righeExport.map((c) => [
          c.nomeCliente,
          c.whatsappCliente,
          formatDataIt(c.submittedAt, true),
          c.stato || "-",
          c.dataOraInvio ? formatDataIt(c.dataOraInvio, true) : "-",
          c.stelle ? `${c.stelle}/5` : "-",
          c.commento || "",
          c.dataRecensione ? formatDataIt(c.dataRecensione, true) : "-",
        ]),
        styles: { fontSize: 8, cellPadding: 1.8, overflow: "linebreak" },
        headStyles: { fillColor: [31, 174, 88] },
        columnStyles: { 6: { cellWidth: 70 } },
      });
      doc.save(`${baseFileName}.pdf`);
    } catch {
      alert("Creazione PDF non riuscita, riprova.");
    } finally {
      setExporting("");
    }
  }

  const statiUnici = Array.from(new Set([STATO_INVIATO, "Non inviato", ...clients.map((c) => c.stato)])).filter(Boolean);
  const selezionabili = clients;

  // Statistiche calcolate sui risultati attualmente filtrati (stato/data),
  // non su tutti i clienti dell'esercente: cambiano insieme ai filtri sopra.
  const stats = useMemo(() => {
    const totale = clients.length;
    const inviati = clients.filter((c) => c.stato === STATO_INVIATO).length;
    const nonInviati = totale - inviati;
    const recensiti = clients.filter((c) => c.stelle !== null).length;
    const perStella = [1, 2, 3, 4, 5].map(
      (n) => clients.filter((c) => c.stelle === n).length
    );
    return { totale, inviati, nonInviati, recensiti, perStella };
  }, [clients]);
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

  function selezionaSoloNonInviati() {
    setSelected(new Set(clients.filter((c) => c.stato !== STATO_INVIATO).map((c) => c.submissionId)));
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

  // Si inviano solo i selezionati non ancora contattati (mai reinvii).
  const clientiDaInviare = clients.filter(
    (c) => selected.has(c.submissionId) && c.stato !== STATO_INVIATO
  );

  async function handleSendConfirm() {
    setSendStep("sending");
    try {
      const res = await fetch("/api/clients/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionIds: clientiDaInviare.map((c) => c.submissionId) }),
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
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">{nomeAttivita}</h1>
            <p className="text-xs text-gray-500">{email}</p>
          </div>
          <div className="flex items-center gap-4">
            {abbonamentoAttivo && !abbonamento.disdettaProgrammata && (
              <button
                onClick={handleDisdici}
                disabled={cancelLoading}
                className="text-sm text-gray-400 hover:text-red-600 disabled:opacity-60"
              >
                {cancelLoading ? "Apertura in corso..." : "Disdici abbonamento"}
              </button>
            )}
            <button onClick={handleLogout} className="text-sm text-gray-500 hover:text-gray-900">
              Esci
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {cancelError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-6 text-sm">
            {cancelError}
          </div>
        )}

        <AbbonamentoBox
          abbonamento={abbonamento}
          attivo={abbonamentoAttivo}
          onRinnova={handleRinnovaPagamento}
          portalLoading={portalLoading}
          portalError={portalError}
        />

        {/* Contatori su tutti i clienti, aggiornati automaticamente */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500">
            Riepilogo generale
            {lastUpdated && <> · aggiornato alle {lastUpdated.toLocaleTimeString("it-IT")}</>}
          </p>
          <button
            onClick={() => loadClients(true)}
            className="text-xs text-gray-500 hover:text-gray-900 underline"
          >
            Aggiorna ora
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <Kpi label="Clienti totali" value={summary ? String(summary.totale) : String(total)} />
          <Kpi label="Richieste inviate" value={summary ? String(summary.inviati) : "—"} />
          <Kpi
            label="Hanno recensito"
            value={summary ? String(summary.recensiti) : "—"}
            sub={
              summary && summary.inviati > 0
                ? `${Math.round((summary.recensiti / summary.inviati) * 100)}% degli inviati`
                : undefined
            }
          />
          <Kpi
            label="Recensioni 4–5★ (Google)"
            value={summary ? String(summary.positive) : "—"}
          />
          <Kpi
            label="Media stelle"
            value={summary?.mediaStelle != null ? summary.mediaStelle.toFixed(1).replace(".", ",") : "—"}
          />
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <p className="text-xs text-gray-500 mb-3">
            Statistiche sui {stats.totale} risultati filtrati sotto
          </p>
          <div className="flex flex-wrap gap-4 mb-4">
            <StatCircle
              label="Inviati"
              value={stats.inviati}
              total={stats.totale}
              colorClass="text-green-600"
              trackClass="text-green-100"
            />
            <StatCircle
              label="Non inviati"
              value={stats.nonInviati}
              total={stats.totale}
              colorClass="text-red-500"
              trackClass="text-red-100"
            />
            <StatCircle
              label="Recensiti"
              value={stats.recensiti}
              total={stats.totale}
              colorClass="text-blue-600"
              trackClass="text-blue-100"
            />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-2">
              Distribuzione voti (dalla 4 in su vanno su Google, sotto restano privati). Clicca un
              voto per filtrare.
            </p>
            <div className="flex flex-wrap gap-3">
              {stats.perStella.map((count, i) => {
                const n = i + 1;
                const pubblica = n >= 4;
                const attivo = stelle === String(n);
                return (
                  <button
                    key={n}
                    onClick={() => updateStelle(attivo ? "" : String(n))}
                    className={`rounded-lg p-1 ${attivo ? "ring-2 ring-amber-400 bg-amber-50" : "hover:bg-gray-50"}`}
                    title={attivo ? "Togli filtro" : `Mostra solo ${n} stelle`}
                  >
                    <StatCircle
                      label={`${n}${"⭐"}`}
                      value={count}
                      total={stats.recensiti}
                      colorClass={pubblica ? "text-amber-500" : "text-gray-400"}
                      trackClass={pubblica ? "text-amber-100" : "text-gray-100"}
                      size={64}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="grow min-w-[180px]">
              <label className="block text-xs text-gray-500 mb-1">Cerca</label>
              <input
                value={cercaInput}
                onChange={(e) => setCercaInput(e.target.value)}
                placeholder="Nome o numero…"
                className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Stato invio</label>
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
              <label className="block text-xs text-gray-500 mb-1">Recensione</label>
              <select
                value={stelle}
                onChange={(e) => updateStelle(e.target.value)}
                className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
              >
                {FILTRI_STELLE.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Registrati dal</label>
              <input
                type="date"
                value={dataDa}
                onChange={(e) => updateDataDa(e.target.value)}
                className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">al</label>
              <input
                type="date"
                value={dataA}
                onChange={(e) => updateDataA(e.target.value)}
                className="rounded-lg border border-gray-300 text-sm px-3 py-1.5"
              />
            </div>
            {filtriAttivi && (
              <button onClick={resetFiltri} className="text-sm text-gray-500 hover:text-gray-900 underline pb-1.5">
                Azzera filtri
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
            <button
              onClick={openAddModal}
              className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-4 py-2 hover:bg-gray-50"
            >
              + Aggiungi cliente
            </button>
            <button
              onClick={openImportModal}
              className="bg-white border border-gray-300 text-gray-700 text-sm rounded-lg px-4 py-2 hover:bg-gray-50"
            >
              Importa CSV
            </button>
            <div className="ml-auto flex gap-2 items-center">
              <span className="text-xs text-gray-500">
                Scarica {selected.size > 0 ? `${selected.size} selezionati` : `elenco (${clients.length})`}:
              </span>
              <button
                onClick={handleExportExcel}
                disabled={!!exporting || righeExport.length === 0}
                className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50"
              >
                {exporting === "xlsx" ? "Preparo…" : "Excel"}
              </button>
              <button
                onClick={handleExportPdf}
                disabled={!!exporting || righeExport.length === 0}
                className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50"
              >
                {exporting === "pdf" ? "Preparo…" : "PDF"}
              </button>
            </div>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-wrap items-center gap-3 justify-between">
            <p className="text-sm text-gray-700">
              <b>{selected.size}</b> selezionat{selected.size === 1 ? "o" : "i"}
              {clientiDaInviare.length !== selected.size && (
                <span className="text-gray-500">
                  {" "}
                  · {clientiDaInviare.length} ancora da inviare (i già inviati non vengono mai
                  ricontattati)
                </span>
              )}
              <button onClick={() => setSelected(new Set())} className="ml-3 text-xs text-gray-500 underline">
                Deseleziona
              </button>
            </p>
            <button
              onClick={openSendModal}
              disabled={!abbonamentoAttivo || clientiDaInviare.length === 0}
              title={
                !abbonamentoAttivo
                  ? "Abbonamento non attivo: rinnova per inviare nuove richieste"
                  : clientiDaInviare.length === 0
                  ? "Tutti i selezionati hanno già ricevuto la richiesta"
                  : undefined
              }
              className="bg-green-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300"
            >
              Invia richiesta recensione ({clientiDaInviare.length})
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={tuttiSelezionati}
                    onChange={toggleSelectAll}
                    disabled={selezionabili.length === 0}
                    title="Seleziona tutti quelli in elenco"
                  />
                </th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">WhatsApp</th>
                <th className="text-left px-4 py-3">Registrato il</th>
                <th className="text-left px-4 py-3">Stato</th>
                <th className="text-left px-4 py-3">Invio</th>
                <th className="text-left px-4 py-3">Recensione</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Caricamento…
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Nessun cliente trovato
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <tr
                    key={c.rowNumber}
                    className={`${rowColorClass(c)} ${selected.has(c.submissionId) ? "outline outline-2 -outline-offset-2 outline-blue-300" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.submissionId)}
                        onChange={() => toggleSelect(c.submissionId)}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{c.nomeCliente}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.whatsappCliente}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDataIt(c.submittedAt, true)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statoBadgeClass(c.stato)}`}
                      >
                        {c.stato || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {c.dataOraInvio ? formatDataIt(c.dataOraInvio, true) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {c.stelle ? (
                        <div>
                          <span className={c.stelle >= 4 ? "text-amber-500" : "text-gray-400"}>
                            {"★".repeat(c.stelle)}
                            <span className="text-gray-200">{"★".repeat(5 - c.stelle)}</span>
                          </span>
                          {c.commento && (
                            <p className="text-xs text-gray-500 max-w-[260px] truncate" title={c.commento}>
                              “{c.commento}”
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {clients.some((c) => c.stato !== STATO_INVIATO) && (
          <p className="text-xs text-gray-500 mt-2">
            Suggerimento:{" "}
            <button onClick={selezionaSoloNonInviati} className="underline hover:text-gray-900">
              seleziona solo i non inviati
            </button>{" "}
            per mandare le richieste in un colpo.
          </p>
        )}
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

/** Cerchio statistico: valore/totale con un anello proporzionale (SVG). */
function StatCircle({
  label,
  value,
  total,
  colorClass,
  trackClass,
  size = 76,
}: {
  label: string;
  value: number;
  total: number;
  colorClass: string;
  trackClass: string;
  size?: number;
}) {
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? value / total : 0;
  const dashoffset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center" style={{ width: size + 8 }}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={6}
            fill="none"
            className={trackClass}
            stroke="currentColor"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={6}
            fill="none"
            className={colorClass}
            stroke="currentColor"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-semibold text-gray-900">{value}</span>
        </div>
      </div>
      <span className="text-[11px] text-gray-500 mt-1 text-center leading-tight">{label}</span>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/** Riquadro "Il tuo abbonamento": stato, piano, prova, rinnovo, ritardi, disdetta. */
function AbbonamentoBox({
  abbonamento: a,
  attivo,
  onRinnova,
  portalLoading,
  portalError,
}: {
  abbonamento: AbbonamentoView;
  attivo: boolean;
  onRinnova: () => void;
  portalLoading: boolean;
  portalError: string;
}) {
  const inRitardo =
    a.stripeStatus === "past_due" ||
    a.stripeStatus === "unpaid" ||
    a.statoPagamento.toLowerCase() === "non pagato" ||
    a.stato.toLowerCase() === "in ritardo";
  const rinnovo = a.prossimoRinnovoStripe || a.dataProssimoRinnovo;
  const giorni = giorniDaOggi(rinnovo);

  let tono = "border-green-200 bg-green-50";
  let titolo = "Abbonamento attivo";
  if (!attivo) {
    tono = "border-amber-200 bg-amber-50";
    titolo = a.stato ? `Abbonamento: ${a.stato}` : "Abbonamento non attivo";
  } else if (inRitardo) {
    tono = "border-red-200 bg-red-50";
    titolo = "Pagamento in ritardo";
  } else if (a.disdettaProgrammata) {
    tono = "border-amber-200 bg-amber-50";
    titolo = "Disdetta programmata";
  } else if (a.inProva) {
    titolo = "Prova gratuita in corso";
  }

  return (
    <div className={`rounded-xl border px-4 py-3 mb-6 text-sm ${tono}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-900">{titolo}</p>
          <p className="text-gray-700 mt-0.5">
            {a.piano !== "—" && (
              <>
                Piano <b>{a.piano}</b>
                {a.importo != null && <> · {a.importo.toFixed(2).replace(".", ",")} €</>}
                {" · "}
              </>
            )}
            {a.inProva && a.fineProva && !a.disdettaProgrammata && (
              <>Prova gratuita fino al <b>{formatDataIt(a.fineProva)}</b> · </>
            )}
            {a.disdettaProgrammata ? (
              <>
                Il servizio resta attivo fino al <b>{formatDataIt(a.fineAccesso)}</b>, poi non si rinnova.
              </>
            ) : attivo && rinnovo ? (
              <>
                {a.inProva ? "Primo addebito" : "Prossimo rinnovo"}: <b>{formatDataIt(rinnovo)}</b>
                {giorni != null && giorni >= 0 && giorni <= 7 && (
                  <span className="text-amber-700"> (tra {giorni === 0 ? "oggi" : `${giorni} giorni`})</span>
                )}
              </>
            ) : null}
            {!attivo && (
              <>Puoi consultare clienti e statistiche, ma l&apos;invio di nuove richieste è disabilitato finché non rinnovi.</>
            )}
          </p>
          {inRitardo && (
            <p className="text-red-700 mt-1">
              L&apos;ultimo addebito non è andato a buon fine
              {a.dataUltimoFallimento && <> ({formatDataIt(a.dataUltimoFallimento)})</>}. Aggiorna il
              metodo di pagamento per non interrompere il servizio.
            </p>
          )}
          {a.dataUltimoPagamento && (
            <p className="text-xs text-gray-500 mt-1">Ultimo pagamento: {formatDataIt(a.dataUltimoPagamento)}</p>
          )}
        </div>
        {(!attivo || inRitardo || a.disdettaProgrammata) && (
          <button
            onClick={onRinnova}
            disabled={portalLoading}
            className="shrink-0 bg-amber-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-amber-700 disabled:opacity-60"
          >
            {portalLoading
              ? "Apertura in corso..."
              : a.disdettaProgrammata
              ? "Annulla disdetta / gestisci"
              : "Rinnova pagamento"}
          </button>
        )}
      </div>
      {portalError && <p className="mt-2 text-red-700">{portalError}</p>}
    </div>
  );
}
