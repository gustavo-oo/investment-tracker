import type { PortfolioPosition } from "../api.ts";

export function OverviewView(_props: {
  reloadToken: number;
  onAbrirPosicoes: (kind: PortfolioPosition["kind"]) => void;
  onAbrirFontes: () => void;
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
