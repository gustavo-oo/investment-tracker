import { ArrowsClockwise, ChartLineUp, ChartPie, Clock, Table } from "@phosphor-icons/react";

const ALOCACOES = ["Por categoria", "Por corretora", "Por objetivo"];

export function DashboardView() {
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
            atualizado às --:--
          </span>
          <button className="btn btn-secondary" disabled title="Disponível na S4">
            <ArrowsClockwise size={15} />
            Atualizar cotações
          </button>
        </div>
      </div>

      <div className="stack">
        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Resumo</h2>
            <p className="section-hint">
              Os valores entram na S4, quando cotações e índices forem coletados e o cálculo do portfólio existir.
            </p>
          </div>
          <div className="stats">
            <div className="stat">
              <span className="stat-label">Patrimônio total</span>
              <span className="stat-value">--</span>
              <span className="stat-note">aguardando S4</span>
            </div>
            <div className="stat">
              <span className="stat-label">Total investido</span>
              <span className="stat-value">--</span>
              <span className="stat-note">aguardando S4</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rendimento</span>
              <span className="stat-value">--</span>
              <span className="stat-note">aguardando S4</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rentabilidade vs CDI</span>
              <span className="stat-value">--</span>
              <span className="stat-note">aguardando S4</span>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Posições</h2>
            <p className="section-hint">Quantidade, preço e valor de mercado por ativo, calculados a partir das cotações.</p>
          </div>
          <div className="empty">
            <Table size={22} />
            <p className="empty-title">Sem posições calculadas</p>
            <p className="empty-hint">
              Importe a planilha na aba Importar e aguarde a S4 para ver a carteira posição a posição.
            </p>
          </div>
        </section>

        <div className="grid-3">
          {ALOCACOES.map((titulo) => (
            <section className="card" key={titulo}>
              <div className="section-head">
                <h2 className="section-title">{titulo}</h2>
              </div>
              <div className="empty">
                <ChartPie size={22} />
                <p className="empty-hint">Distribuição disponível na S4.</p>
              </div>
            </section>
          ))}
        </div>

        <section className="card">
          <div className="section-head">
            <h2 className="section-title">Evolução 12 meses</h2>
            <p className="section-hint">Comparação com CDI e IPCA a partir das valuations mensais.</p>
          </div>
          <div className="chart-placeholder">
            <ChartLineUp size={22} />
            <p className="empty-title">Gráfico chega na S6</p>
            <p className="empty-hint">Será desenhado com Recharts quando a reconciliação mensal estiver pronta.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
