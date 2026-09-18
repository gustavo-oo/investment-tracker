import { useEffect, useState } from "react";
import { getImportRuns, postImport, type ImportPayload, type ImportRun, type ImportSummary } from "../api.ts";
import { formataBRL } from "../format.ts";

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const normalizeName = (name: string): string =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\.csv$/, "").trim();

function pickCsv(files: File[], expected: string): File | undefined {
  const exact = files.find((file) => normalizeName(file.name) === expected);
  if (exact) return exact;
  const candidates = files.filter((file) => normalizeName(file.name).includes(expected));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function payloadFromFiles(files: File[], dryRun: boolean): Promise<ImportPayload> {
  if (files.length === 1 && files[0]!.name.toLowerCase().endsWith(".xlsx")) {
    return readAsBase64(files[0]!).then((workbookBase64) => ({ workbookBase64, dryRun }));
  }
  const assets = pickCsv(files, "lista de ativos");
  const transactions = pickCsv(files, "investimentos");
  const history = pickCsv(files, "evolucao");
  if (!assets || !transactions || !history) {
    return Promise.reject(new Error("envie o .xlsx do Sheets ou os 3 CSVs (Lista de Ativos, Investimentos, Evolução)"));
  }
  return Promise.all([assets.text(), transactions.text(), history.text()]).then(([assetsCsv, transactionsCsv, historyCsv]) => ({
    assetsCsv, transactionsCsv, historyCsv, dryRun,
  }));
}

export function ImportView() {
  const [files, setFiles] = useState<File[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<ImportRun[]>([]);

  const refreshRuns = () => getImportRuns().then(setRuns).catch(() => setRuns([]));
  useEffect(() => { void refreshRuns(); }, []);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const payload = await payloadFromFiles(files, dryRun);
      const result = await postImport(payload);
      setSummary(result);
      if (!dryRun) await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const canRun = files.length > 0 && !busy;

  return (
    <div className="import">
      <section className="card">
        <h2>Importar</h2>
        <p>Envie o <code>.xlsx</code> exportado do Google Sheets (recomendado) ou os 3 CSVs.</p>
        <input
          type="file"
          accept=".xlsx,.csv"
          multiple
          onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setSummary(null); setError(null); }}
        />
        <div className="actions">
          <button disabled={!canRun} onClick={() => void run(true)}>Validar (prévia)</button>
          <button disabled={!canRun} onClick={() => void run(false)}>Importar</button>
        </div>
        {busy && <p>Processando…</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {summary && (
        <section className="card">
          <h3>{summary.dryRun ? "Prévia (nada foi gravado)" : "Import concluído"}</h3>
          <ul>
            <li>{summary.instruments} instrumentos</li>
            <li>{summary.transactions} transações</li>
            <li>{summary.historyRows} linhas de histórico</li>
            <li>último mês: {summary.latestMonth ?? "—"} · total {formataBRL(summary.latestTotalCents)}</li>
          </ul>
          {summary.warnings.length > 0 && (
            <div className="warn">
              <strong>Avisos</strong>
              <ul>{summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          )}
          {summary.errors.length > 0 && (
            <div className="error">
              <strong>Erros</strong>
              <ul>{summary.errors.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h3>Últimos imports</h3>
        {runs.length === 0 ? <p>Nenhum import ainda.</p> : (
          <table>
            <thead>
              <tr><th>Quando</th><th>Fonte</th><th>Ativos</th><th>Transações</th><th>Histórico</th><th>Status</th></tr>
            </thead>
            <tbody>
              {runs.map((item) => (
                <tr key={item.id}>
                  <td>{item.importedAt}</td>
                  <td>{item.source}</td>
                  <td>{item.instruments}</td>
                  <td>{item.transactions}</td>
                  <td>{item.historyRows}</td>
                  <td>{item.status === "ok" ? "ok" : `erro: ${item.message ?? ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
