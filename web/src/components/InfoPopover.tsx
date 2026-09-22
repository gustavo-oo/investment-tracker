import type { ReactNode } from "react";
import { Info } from "@phosphor-icons/react";

export function InfoPopover({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <span className="info">
      <button type="button" className="info-btn" aria-label={rotulo}>
        <Info size={16} aria-hidden="true" />
      </button>
      <span className="info-pop" role="tooltip">{children}</span>
    </span>
  );
}

export function ExplicacaoRendimentos() {
  return (
    <InfoPopover rotulo="Entenda os dois rendimentos">
      <span className="info-pop-titulo">Dois jeitos de medir o rendimento</span>
      <span className="info-pop-item">
        <span className="info-pop-rotulo">Seu rendimento real — MWR (ponderado pelo dinheiro)</span>
        <span className="info-pop-texto">Considera quando e quanto você aportou ou resgatou. É o ganho do seu bolso, o que de fato entrou na conta.</span>
      </span>
      <span className="info-pop-item">
        <span className="info-pop-rotulo">Comparação com o mercado — TWR (ponderado pelo tempo)</span>
        <span className="info-pop-texto">Ignora aportes e resgates. Mede a qualidade da estratégia e é o número justo para comparar com CDI, IPCA e outros fundos.</span>
      </span>
      <span className="info-pop-texto">Em resumo: TWR responde "a carteira foi bem?"; MWR responde "eu ganhei dinheiro?".</span>
    </InfoPopover>
  );
}
