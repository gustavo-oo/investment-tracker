import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  ClockCounterClockwise,
  FileCsv,
  FileXls,
  Trash,
  UploadSimple,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";
import { getImportRuns, postImport, type ImportPayload, type ImportRun, type ImportSummary } from "../api.ts";
import { formataBRL, formataDataHora, formataFonte, formataMes, formataNumero, formataTamanho } from "../format.ts";

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const normalizeName = (name: string): string =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\.csv$/, "").trim();

function pickCsv(files: File[], exactName: string, token: string): File | undefined {
  const exact = files.find((file) => normalizeName(file.name) === exactName);
  if (exact) return exact;
  const candidates = files.filter((file) => normalizeName(file.name).includes(token));
  return candidates.length === 1 ? candidates[0] : undefined;
}

function payloadFromFiles(files: File[], dryRun: boolean): Promise<ImportPayload> {
  if (files.length === 1 && files[0]!.name.toLowerCase().endsWith(".xlsx")) {
    return readAsBase64(files[0]!).then((workbookBase64) => ({ workbookBase64, dryRun }));
  }
  const assets = pickCsv(files, "lista de ativos", "ativos");
  const transactions = pickCsv(files, "investimentos", "investimentos");
  const history = pickCsv(files, "evolucao", "evolu");
  if (!assets || !transactions || !history) {
    return Promise.reject(new Error("envie o .xlsx do Sheets ou os 3 CSVs (Lista de Ativos, Investimentos, Evolução)"));
  }
  return Promise.all([assets.text(), transactions.text(), history.text()]).then(([assetsCsv, transactionsCsv, historyCsv]) => ({
    assetsCsv, transactionsCsv, historyCsv, dryRun,
  }));
}

export function ImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"validate" | "import" | null>(null);
  const [runs, setRuns] = useState<ImportRun[] | null>(null);

  const refreshRuns = () => getImportRuns().then(setRuns).catch(() => setRuns([]));
  useEffect(() => { void refreshRuns(); }, []);

  function selectFiles(selected: File[]) {
    setFiles(selected);
    setSummary(null);
    setError(null);
  }

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "validate" : "import");
    setError(null);
    setSummary(null);
    try {
      const payload = await payloadFromFiles(files, dryRun);
      const result = await postImport(payload);
      setSummary(result);
      if (!dryRun && result.errors.length === 0) await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const canRun = files.length > 0 && busy === null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Importar</h1>
          <p className="page-sub">
            Envie o .xlsx exportado do Google Sheets (recomendado) ou os 3 CSVs. O import substitui os dados atuais
            numa transação única e fica registrado no histórico.
          </p>
        </div>
      </div>

      <div className="stack">
        <section className="card">
          <label
            className={dragging ? "dropzone dragging" : "dropzone"}
            htmlFor="import-files"
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <UploadSimple size={26} className="dropzone-icon" aria-hidden="true" />
            <span className="dropzone-title">Arraste o arquivo aqui ou clique para escolher</span>
            <span className="dropzone-hint">Aceita o .xlsx do Sheets ou os 3 CSVs (Lista de Ativos, Investimentos, Evolução)</span>
            <input
              ref={inputRef}
              id="import-files"
              className="sr-only"
              type="file"
              accept=".xlsx,.csv"
              multiple
              onChange={(event) => selectFiles(Array.from(event.target.files ?? []))}
            />
          </label>

          {files.length > 0 && (
            <ul className="file-list">
              {files.map((file, index) => (
                <li className="file-item" key={`${file.name}-${file.size}`}>
                  {file.name.toLowerCase().endsWith(".xlsx") ? (
                    <FileXls size={16} className="file-icon" aria-hidden="true" />
                  ) : (
                    <FileCsv size={16} className="file-icon" aria-hidden="true" />
                  )}
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formataTamanho(file.size)}</span>
                  <button
                    type="button"
                    className="file-remove"
                    aria-label={`Remover ${file.name}`}
                    onClick={() => selectFiles(files.filter((_, position) => position !== index))}
                  >
                    <Trash size={14} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="actions">
            <button className="btn btn-secondary" type="button" disabled={!canRun} onClick={() => void run(true)}>
              {busy === "validate" ? "Validando..." : "Validar prévia"}
            </button>
            <button className="btn btn-primary" type="button" disabled={!canRun} onClick={() => void run(false)}>
              {busy === "import" ? "Importando..." : "Importar"}
            </button>
          </div>
        </section>

        <div aria-live="polite">
          {error && (
            <div className="callout callout-error" role="alert">
              <XCircle size={17} aria-hidden="true" />
              <div>
                <p className="callout-title">Não foi possível enviar</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {summary && (
            <section className="card">
              <div className="summary-head">
                <CheckCircle size={18} aria-hidden="true" />
                {summary.dryRun ? "Prévia concluída, nada foi gravado" : "Import concluído"}
              </div>
              <div className="stats">
                <div className="stat">
                  <span className="stat-label">Ativos</span>
                  <span className="stat-value">{formataNumero(summary.instruments)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Transações</span>
                  <span className="stat-value">{formataNumero(summary.transactions)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Linhas de histórico</span>
                  <span className="stat-value">{formataNumero(summary.historyRows)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Último mês</span>
                  <span className="stat-value">{summary.latestMonth ? formataMes(summary.latestMonth) : "--"}</span>
                  <span className="stat-note">total {formataBRL(summary.latestTotalCents)}</span>
                </div>
              </div>

              {summary.warnings.length > 0 && (
                <div className="callout callout-warn callout-spaced">
                  <WarningCircle size={17} aria-hidden="true" />
                  <div>
                    <p className="callout-title">Avisos</p>
                    <ul>
                      {summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              {summary.errors.length > 0 && (
                <div className="callout callout-error callout-spaced">
                  <XCircle size={17} aria-hidden="true" />
                  <div>
                    <p className="callout-title">Erros</p>
                    <ul>
                      {summary.errors.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Últimos imports</h2>
            <p className="section-hint">Cada envio confirmado substitui os dados e aparece aqui para auditoria.</p>
          </div>

          {runs === null ? (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Histórico de imports em carregamento</caption>
                <thead>
                  <tr><th>Quando</th><th>Fonte</th><th>Ativos</th><th>Transações</th><th>Histórico</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((row) => (
                    <tr key={row}>
                      {[0, 1, 2, 3, 4, 5].map((cell) => (
                        <td key={cell}><span className="skeleton" style={{ width: cell === 0 ? 120 : 48 }} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : runs.length === 0 ? (
            <div className="empty">
              <ClockCounterClockwise size={22} aria-hidden="true" />
              <p className="empty-title">Nenhum import registrado</p>
              <p className="empty-hint">Envie o .xlsx do Sheets ou os 3 CSVs acima para criar o primeiro registro.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Histórico de imports</caption>
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col">Fonte</th>
                    <th scope="col">Ativos</th>
                    <th scope="col">Transações</th>
                    <th scope="col">Histórico</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((item) => (
                    <tr key={item.id}>
                      <td className="num">{formataDataHora(item.importedAt)}</td>
                      <td>{formataFonte(item.source)}</td>
                      <td className="num">{formataNumero(item.instruments)}</td>
                      <td className="num">{formataNumero(item.transactions)}</td>
                      <td className="num">{formataNumero(item.historyRows)}</td>
                      <td>
                        {item.status === "ok" ? (
                          <span className="badge badge-ok">
                            <CheckCircle size={12} aria-hidden="true" />
                            ok
                          </span>
                        ) : (
                          <>
                            <span className="badge badge-error">
                              <XCircle size={12} aria-hidden="true" />
                              erro
                            </span>
                            {item.message && <p className="cell-error">{item.message}</p>}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
