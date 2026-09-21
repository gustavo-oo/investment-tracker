import type { PortfolioPosition } from "../api.ts";

export function PositionsView(_props: {
  reloadToken: number;
  filtroInicial: PortfolioPosition["kind"] | null;
}) {
  return (
    <div className="page">
      <div className="empty">
        <p className="empty-title">Em construção</p>
        <p className="empty-hint">Esta seção chega na próxima task.</p>
      </div>
    </div>
  );
}
