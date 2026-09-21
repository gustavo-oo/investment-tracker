import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, ChartPie, Clock, Table, WarningCircle, XCircle } from "@phosphor-icons/react";
import {
  getAllocation, getHealth, getHistory, getPortfolio, getReconciliation, postRefresh,
  type Allocation, type AllocationBy, type Health, type HistoryPoint, type Portfolio, type Reconciliation,
} from "../api.ts";
import {
  formataBRL, formataCategoria, formataHora, formataMes, formataNumero, formataPercentual,
  formataQuantidade, mesDeslocado,
} from "../format.ts";

type DashboardData = {
  portfolio: Portfolio;
  history: HistoryPoint[];
  allocations: Allocation[];
  reconciliation: Reconciliation;
  health: Health;
};

const ALOCACOES: Array<{ by: AllocationBy; titulo: string }> = [
  { by: "category", titulo: "Por categoria" },
  { by: "broker", titulo: "Por corretora" },
  { by: "objective", titulo: "Por objetivo" },
];

const ROTULO_CAUSA: Record<string, string> = {
  "residuo-zerado": "Resíduo zerado (regra)",
  "transacao-fora-da-janela": "Transação posterior à data do snapshot",
  "legado-snapshot-maio-2025": "Snapshot do legado menor que o principal (maio/2025)",
  "legado-sem-cdi-maio-2026": "Legado sem capitalização CDI (maio/2026)",
  "legado-sem-selic-junho-2026": "Legado sem capitalização Selic (junho/2026)",
  "fonte-yahoo-corrompida": "Fonte Yahoo corrompida no histórico",
  "data-de-referencia": "Data de referência do snapshot do legado",
  "nao-explicada": "Não explicada",
};

async function carregaDashboard(): Promise<DashboardData> {
  const portfolio = await getPortfolio();
  const mes = portfolio.asOf.slice(0, 7);
  const [history, allocations] = await Promise.all([
    getHistory(mesDeslocado(mes, -11), mes),
    Promise.all(ALOCACOES.map((item) => getAllocation(item.by))),
  ]);
  const [reconciliation, health] = await Promise.all([getReconciliation(mes), getHealth()]);
  return { portfolio, history, allocations, reconciliation, health };
}

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setData(await carregaDashboard());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void carregar();
    const id = setInterval(() => void carregar(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [carregar]);

  async function atualizar() {
    setBusy(true);
    setError(null);
    try {
      await postRefresh();
      await carregar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-sub">Posições, alocação e evolução mensal da carteira.</p>
          </div>
        </div>
        <div className="stack">
          {error !== null && (
            <div className="callout callout-error" role="alert">
              <XCircle size={17} aria-hidden="true" />
              <div>
                <p className="callout-title">Não foi possível carregar</p>
                <p>{error}</p>
              </div>
            </div>
          )}
          <section className="card">
            <div className="stats">
              {[0, 1, 2, 3].map((item) => (
                <div className="stat" key={item}>
                  <span className="skeleton" style={{ width: 90 }} />
                  <span className="skeleton" style={{ width: 140, height: 22 }} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  const { portfolio, history, allocations, reconciliation, health } = data;
  const total = portfolio.totals.marketValueCents;
  const capital = portfolio.totals.investedCents - portfolio.totals.redeemedCents;
  const rendimento = total - capital;
  const rendimentoPct = capital > 0 ? (rendimento / capital) * 100 : 0;
  const primeiro = history[0];
  const ultimo = history.at(-1);
  const aportes = history.reduce((acc, point) => acc + point.investedCents, 0);
  const resgates = history.reduce((acc, point) => acc + point.redeemedCents, 0);
  const carteira12m = primeiro && primeiro.marketValueCents > 0 && ultimo
    ? ((ultimo.marketValueCents + resgates - aportes - primeiro.marketValueCents) / primeiro.marketValueCents) * 100
    : 0;
  const acumula = (campo: "cdiPct" | "ipcaPct"): number =>
    history.reduce((acc, point) => (point[campo] === null ? acc : acc * (1 + point[campo]! / 100)), 1) * 100 - 100;
  const ultimaAtualizacao = health.sources
    .map((source) => source.lastSuccessAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);
  const posicoes = [...portfolio.positions].sort((a, b) => (b.marketValueCents ?? 0) - (a.marketValueCents ?? 0));
  const fontesStale = health.sources.filter((source) => source.stale);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Posições, alocação e evolução mensal da carteira.</p>
        </div>
        <div className="page-head-actions">
          <span className="updated">
            <Clock size={14} />
            {ultimaAtualizacao ? `atualizado às ${formataHora(ultimaAtualizacao)}` : "sem coleta registrada"}
          </span>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void atualizar()}>
            <ArrowsClockwise size={15} />
            {busy ? "Atualizando..." : "Atualizar cotações"}
          </button>
        </div>
      </div>

      <div className="stack">
        {error !== null && (
          <div className="callout callout-error" role="alert">
            <XCircle size={17} aria-hidden="true" />
            <div>
              <p className="callout-title">Falha ao atualizar</p>
              <p>{error}</p>
            </div>
          </div>
        )}

        {fontesStale.length > 0 && (
          <div className="callout callout-warn">
            <WarningCircle size={17} aria-hidden="true" />
            <div>
              <p className="callout-title">Fontes desatualizadas</p>
              <p>{fontesStale.map((source) => source.id).join(", ")} — último valor mantido.</p>
            </div>
          </div>
        )}

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Resumo</h2>
            <p className="section-hint">Posição em {portfolio.asOf}, com a última cotação disponível de cada fonte.</p>
          </div>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Patrimônio total</span>
              <span className="stat-value">{formataBRL(total)}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Capital investido</span>
              <span className="stat-value">{formataBRL(capital)}</span>
              <span className="stat-note">aportes − resgates</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rendimento</span>
              <span className="stat-value">{formataBRL(rendimento)}</span>
              <span className="stat-note">{formataPercentual(rendimentoPct)} sobre o capital</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rentabilidade 12m</span>
              <span className="stat-value">{formataPercentual(carteira12m)}</span>
              <span className="stat-note">CDI {formataPercentual(acumula("cdiPct"))} · IPCA {formataPercentual(acumula("ipcaPct"))}</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Posições</h2>
            <p className="section-hint">Quantidade, preço e valor de mercado por ativo, ordenados por valor.</p>
          </div>
          {posicoes.length === 0 ? (
            <div className="empty">
              <Table size={22} aria-hidden="true" />
              <p className="empty-title">Sem posições</p>
              <p className="empty-hint">Importe a planilha na aba Importar.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Posições da carteira</caption>
                <thead>
                  <tr>
                    <th scope="col">Ativo</th>
                    <th scope="col">Categoria</th>
                    <th scope="col" className="num">Quantidade</th>
                    <th scope="col" className="num">Preço</th>
                    <th scope="col" className="num">Valor</th>
                    <th scope="col" className="num">%</th>
                  </tr>
                </thead>
                <tbody>
                  {posicoes.map((posicao) => (
                    <tr key={posicao.instrumentId}>
                      <td>
                        {posicao.name}
                        {posicao.stale && <span className="badge badge-warn">stale</span>}
                      </td>
                      <td>{formataCategoria(posicao.category)}</td>
                      <td className="num">{posicao.quantityE8 === null ? "—" : formataQuantidade(posicao.quantityE8)}</td>
                      <td className="num">{posicao.priceCents === null ? "—" : formataBRL(posicao.priceCents)}</td>
                      <td className="num">{formataBRL(posicao.marketValueCents ?? 0)}</td>
                      <td className="num">{total > 0 ? formataPercentual(((posicao.marketValueCents ?? 0) / total) * 100) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid-3">
          {ALOCACOES.map((item, index) => (
            <section className="card" key={item.by}>
              <div className="section-head">
                <h2 className="section-title">{item.titulo}</h2>
              </div>
              {allocations[index] && allocations[index]!.groups.length > 0 ? (
                <ul className="alloc-list">
                  {allocations[index]!.groups.map((group) => (
                    <li className="alloc-row" key={group.key}>
                      <div className="alloc-line">
                        <span className="alloc-name">{item.by === "category" ? formataCategoria(group.key) : group.key}</span>
                        <span className="alloc-value">{formataBRL(group.marketValueCents)} · {formataPercentual(group.pct)}</span>
                      </div>
                      <span className="alloc-bar">
                        <span className="alloc-bar-fill" style={{ width: `${Math.min(100, group.pct)}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty">
                  <ChartPie size={22} aria-hidden="true" />
                  <p className="empty-hint">Sem dados de alocação.</p>
                </div>
              )}
            </section>
          ))}
        </div>

        <section className="card">
          <details className="recon">
            <summary>
              <span className="section-title">Reconciliação — {formataMes(reconciliation.month)}</span>
              {reconciliation.unexplained === 0 ? (
                <span className="badge badge-ok">{formataNumero(reconciliation.divergences.length)} divergências explicadas</span>
              ) : (
                <span className="badge badge-error">{formataNumero(reconciliation.unexplained)} não explicadas</span>
              )}
            </summary>
            <p className="section-hint">
              Compara o cálculo do app com o snapshot do legado em {reconciliation.asOf}. Divergências conhecidas têm causa
              registrada; igualdade não é forçada.
            </p>
            <div className="stats">
              <div className="stat">
                <span className="stat-label">Legado</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.legacyCents)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Referência (resíduos zerados)</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.referenceCents)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Nosso</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.ourCents)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Diferença</span>
                <span className="stat-value">{formataBRL(reconciliation.totals.diffCents)}</span>
              </div>
            </div>
            {reconciliation.divergences.length > 0 && (
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Divergências da reconciliação</caption>
                  <thead>
                    <tr>
                      <th scope="col">Ativo</th>
                      <th scope="col" className="num">Legado</th>
                      <th scope="col" className="num">Nosso</th>
                      <th scope="col" className="num">Diferença</th>
                      <th scope="col">Causa</th>
                    </tr>
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
      </div>
    </div>
  );
}
