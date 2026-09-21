import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react";
import { getHealth, getReconciliation, postRefresh, type Health, type Reconciliation, type ReconciliationCause, type RefreshResult } from "../api.ts";
import { formataBRL, formataDataHora, formataMes, formataNumero } from "../format.ts";

const ROTULO_CAUSA: Record<ReconciliationCause, string> = {
  "residuo-zerado": "Resíduo zerado (regra)",
  "transacao-fora-da-janela": "Transação posterior à data do snapshot",
  "legado-snapshot-maio-2025": "Snapshot do legado menor que o principal (maio/2025)",
  "legado-sem-cdi-maio-2026": "Legado sem capitalização CDI (maio/2026)",
  "legado-sem-selic-junho-2026": "Legado sem capitalização Selic (junho/2026)",
  "fonte-yahoo-corrompida": "Fonte Yahoo corrompida no histórico",
  "data-de-referencia": "Data de referência do snapshot do legado",
  "cotacao-fora-da-janela": "Cotação posterior ao snapshot do legado (mês corrente)",
  "nao-explicada": "Não explicada",
};

const mesAtual = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);

export function SourcesView({ reloadToken }: { reloadToken: number }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [resultado, setResultado] = useState<RefreshResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const refreshController = useRef<AbortController | null>(null);

  const carregar = useCallback(async (signal: AbortSignal) => {
    try {
      const [novoHealth, novaRecon] = await Promise.all([getHealth(signal), getReconciliation(mesAtual(), signal)]);
      setHealth(novoHealth);
      setReconciliation(novaRecon);
      setErro(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setErro(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void carregar(controller.signal);
    const id = setInterval(() => void carregar(controller.signal), 5 * 60 * 1000);
    return () => {
      controller.abort();
      refreshController.current?.abort();
      clearInterval(id);
    };
  }, [carregar, reloadToken]);

  async function atualizar() {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    setBusy(true);
    setErro(null);
    try {
      const novoResultado = await postRefresh();
      if (controller.signal.aborted) return;
      setResultado(novoResultado);
      await carregar(controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setErro(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Fontes</h1>
          <p className="page-sub">Coleta, desatualização e reconciliação com o legado.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void atualizar()}>
            <ArrowsClockwise size={15} />
            {busy ? "Atualizando..." : "Atualizar cotações"}
          </button>
        </div>
      </div>

      {erro !== null && (
        <div className="callout callout-error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <div><p className="callout-title">Falha</p><p>{erro}</p></div>
        </div>
      )}

      <div className="stack">
        <section className="card">
          <div className="section-head"><h2 className="section-title">Estado das fontes</h2></div>
          {health === null ? (
            <p className="section-hint">Carregando...</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">Fonte</th><th scope="col">Última tentativa</th><th scope="col">Último sucesso</th><th scope="col">Estado</th><th scope="col">Último erro</th></tr>
                </thead>
                <tbody>
                  {health.sources.map((source) => (
                    <tr key={source.id}>
                      <td>{source.id}</td>
                      <td>{source.lastAttemptAt === null ? "—" : formataDataHora(source.lastAttemptAt)}</td>
                      <td>{source.lastSuccessAt === null ? "—" : formataDataHora(source.lastSuccessAt)}</td>
                      <td>{source.stale ? <span className="badge badge-warn">desatualizado</span> : <span className="badge badge-ok">ok</span>}</td>
                      <td>{source.lastError ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {resultado !== null && (
          <section className="card">
            <div className="section-head"><h2 className="section-title">Resultado do refresh</h2></div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th scope="col">Fonte</th><th scope="col" className="num">Buscados</th><th scope="col" className="num">Inseridos</th><th scope="col" className="num">Atualizados</th><th scope="col" className="num">Pulados</th><th scope="col">Erros</th></tr>
                </thead>
                <tbody>
                  {resultado.sources.map((source) => (
                    <tr key={source.id}>
                      <td>{source.id}</td>
                      <td className="num">{source.fetched}</td>
                      <td className="num">{source.inserted}</td>
                      <td className="num">{source.updated}</td>
                      <td className="num">{source.skipped}</td>
                      <td>{source.errors.length === 0 ? "—" : source.errors.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resultado.repairs.length > 0 && (
              <p className="section-hint">
                Reparo: {resultado.repairs.map((repair) => repair.skipped === true
                  ? `${repair.ticker} ${repair.from}..${repair.to}: pulado (sem cotação mensal)`
                  : repair.error !== undefined
                    ? `${repair.ticker} ${repair.from}..${repair.to} falhou (${repair.error})`
                    : `${repair.ticker} ${repair.from}..${repair.to}: ${repair.deleted} linhas apagadas, ${repair.inserted} pontos gravados`).join(" · ")}
              </p>
            )}
          </section>
        )}

        {reconciliation !== null && (
          <section className="card">
            <details className="recon" open={reconciliation.unexplained > 0}>
              <summary>
                <span className="section-title">Reconciliação — {formataMes(reconciliation.month)}</span>
                {reconciliation.unexplained === 0 ? (
                  <span className="badge badge-ok">{formataNumero(reconciliation.divergences.length)} divergências explicadas</span>
                ) : (
                  <span className="badge badge-error">{formataNumero(reconciliation.unexplained)} não explicadas</span>
                )}
              </summary>
              <p className="section-hint">Compara o cálculo do app com o snapshot do legado em {reconciliation.asOf}. Divergências conhecidas têm causa registrada; igualdade não é forçada.</p>
              <div className="stats">
                <div className="stat"><span className="stat-label">Legado</span><span className="stat-value">{formataBRL(reconciliation.totals.legacyCents)}</span></div>
                <div className="stat"><span className="stat-label">Referência (resíduos zerados)</span><span className="stat-value">{formataBRL(reconciliation.totals.referenceCents)}</span></div>
                <div className="stat"><span className="stat-label">Nosso</span><span className="stat-value">{formataBRL(reconciliation.totals.ourCents)}</span></div>
                <div className="stat"><span className="stat-label">Diferença</span><span className="stat-value">{formataBRL(reconciliation.totals.diffCents)}</span></div>
              </div>
              {reconciliation.divergences.length > 0 && (
                <div className="table-wrap">
                  <table>
                    <caption className="sr-only">Divergências da reconciliação</caption>
                    <thead>
                      <tr><th scope="col">Ativo</th><th scope="col" className="num">Legado</th><th scope="col" className="num">Nosso</th><th scope="col" className="num">Diferença</th><th scope="col">Causa</th></tr>
                    </thead>
                    <tbody>
                      {reconciliation.divergences.map((divergence) => (
                        <tr key={divergence.instrumentId}>
                          <td>{divergence.name}</td>
                          <td className="num">{formataBRL(divergence.legacyCents)}</td>
                          <td className="num">{formataBRL(divergence.ourCents)}</td>
                          <td className="num">{formataBRL(divergence.diffCents)}</td>
                          <td>{ROTULO_CAUSA[divergence.cause] ?? divergence.cause}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          </section>
        )}
      </div>
    </div>
  );
}
