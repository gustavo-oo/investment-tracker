import { useCallback, useEffect, useState } from "react";
import { ArrowsClockwise, ChartLine, ChartLineUp, Coins, Table, Target } from "@phosphor-icons/react";
import { getHealth, postRefresh, type Health } from "./api.ts";
import { formataHora } from "./format.ts";
import { Logo } from "./Logo.tsx";
import type { Classe } from "./classes.ts";
import { OverviewView } from "./views/OverviewView.tsx";
import { PositionsView } from "./views/PositionsView.tsx";
import { RebalanceView } from "./views/RebalanceView.tsx";
import { EvolutionView } from "./views/EvolutionView.tsx";
import { SourcesView } from "./views/SourcesView.tsx";

type View = "visao-geral" | "posicoes" | "rebalanceamento" | "evolucao" | "fontes";

const ITENS: Array<{ id: View; rotulo: string; Icone: typeof Coins }> = [
  { id: "visao-geral", rotulo: "Visão geral", Icone: ChartLineUp },
  { id: "posicoes", rotulo: "Posições", Icone: Table },
  { id: "rebalanceamento", rotulo: "Rebalanceamento", Icone: Target },
  { id: "evolucao", rotulo: "Evolução", Icone: ChartLine },
  { id: "fontes", rotulo: "Fontes", Icone: Coins },
];

function ultimaColeta(health: Health | null): string | null {
  if (health === null) return null;
  return health.sources.map((source) => source.lastSuccessAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

const ROTULO_FONTE_CURTO: Record<string, string> = {
  yahoo: "Yahoo",
  bcb: "BCB",
  "cvm-swb": "CVM",
  alphavantage: "Alpha Vantage",
};

export function App() {
  const [view, setView] = useState<View>("visao-geral");
  const [health, setHealth] = useState<Health | null>(null);
  const [filtroPosicoes, setFiltroPosicoes] = useState<Classe | null>(null);
  const [busy, setBusy] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const carregaHealth = useCallback(async () => {
    try {
      setHealth(await getHealth());
    } catch {
      /* mantém o último health */
    }
  }, []);

  useEffect(() => {
    void carregaHealth();
    const id = setInterval(() => void carregaHealth(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [carregaHealth]);

  function abrirPosicoes(classe: Classe | null) {
    setFiltroPosicoes(classe);
    setView("posicoes");
  }

  async function atualizar() {
    setBusy(true);
    setRecado(null);
    try {
      const result = await postRefresh();
      const erros = [
        ...result.sources.flatMap((source) => source.errors.map((erro) => `${source.id}: ${erro}`)),
        ...result.repairs.filter((repair) => repair.error !== undefined).map((repair) => `${repair.ticker}: ${repair.error}`),
      ];
      setRecado(erros.length > 0 ? erros.join("; ") : "cotações atualizadas");
      await carregaHealth();
      setReloadToken((token) => token + 1);
    } catch (cause) {
      setRecado(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const stale = health?.sources.some((source) => source.stale) ?? false;
  const ultima = ultimaColeta(health);

  return (
    <div className="app">
      <aside className="sidebar">
        <p className="brand">
          <Logo />
          Meus Investimentos
        </p>
        <nav className="nav" aria-label="Seções">
          {ITENS.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              type="button"
              className={view === id ? "nav-item active" : "nav-item"}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icone size={17} aria-hidden="true" />
              {rotulo}
              {id === "fontes" && stale && <span className="dot" aria-label="fontes desatualizadas" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="updated">{ultima ? `atualizado às ${formataHora(ultima)}` : "sem coleta registrada"}</span>
          {health !== null && health.sources.length > 0 && (
            <ul className="sidebar-fontes" aria-label="Fontes de dados">
              {health.sources.map((source) => {
                const rotulo = ROTULO_FONTE_CURTO[source.id] ?? source.id;
                const hora = source.lastSuccessAt === null ? "sem coleta" : formataHora(source.lastSuccessAt);
                return (
                  <li key={source.id} className={source.stale ? "fonte-mini fonte-mini-warn" : "fonte-mini"}>
                    <span className={source.stale ? "fonte-dot fonte-dot-warn" : "fonte-dot fonte-dot-ok"} aria-hidden="true" />
                    <span title={`${rotulo}: ${source.stale ? "desatualizada" : "ok"}, última coleta ${hora}`}>{rotulo}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => void atualizar()}>
            <ArrowsClockwise size={15} />
            {busy ? "Atualizando..." : "Atualizar cotações"}
          </button>
          {recado !== null && <p className="sidebar-recado" role="status">{recado}</p>}
        </div>
      </aside>
      <main className="content">
        {view === "visao-geral" && (
          <OverviewView reloadToken={reloadToken} onAbrirPosicoes={abrirPosicoes} />
        )}
        {view === "posicoes" && <PositionsView reloadToken={reloadToken} filtroInicial={filtroPosicoes} />}
        {view === "rebalanceamento" && <RebalanceView reloadToken={reloadToken} />}
        {view === "evolucao" && <EvolutionView reloadToken={reloadToken} />}
        {view === "fontes" && <SourcesView reloadToken={reloadToken} />}
      </main>
    </div>
  );
}
