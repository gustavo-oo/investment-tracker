import { PERIODOS, type Periodo } from "../periodos.ts";

export type Aba = "rs" | "pct";
export type SubAba = "mes" | "acumulado";

export function ControlesGrafico({ aba, onAba, subAba, onSubAba, periodo, onPeriodo, trimestral }: {
  aba: Aba; onAba: (aba: Aba) => void;
  subAba: SubAba; onSubAba: (subAba: SubAba) => void;
  periodo: Periodo; onPeriodo: (periodo: Periodo) => void;
  trimestral?: boolean;
}) {
  return (
    <div className="chart-controles-grafico">
      <div className="chart-grupo" role="group" aria-label="Visão">
        <button type="button" className={aba === "rs" ? "chip active" : "chip"} aria-pressed={aba === "rs"} onClick={() => onAba("rs")}>R$</button>
        <button type="button" className={aba === "pct" ? "chip active" : "chip"} aria-pressed={aba === "pct"} onClick={() => onAba("pct")}>%</button>
      </div>
      <div className="chart-grupo" role="group" aria-label="Granularidade">
        <button type="button" className={subAba === "mes" ? "chip active" : "chip"} aria-pressed={subAba === "mes"} onClick={() => onSubAba("mes")}>Mês a mês</button>
        <button type="button" className={subAba === "acumulado" ? "chip active" : "chip"} aria-pressed={subAba === "acumulado"} onClick={() => onSubAba("acumulado")}>Acumulado</button>
      </div>
      <div className="chart-grupo" role="group" aria-label="Período">
        {PERIODOS.map((item) => (
          <button key={item.id} type="button" className={periodo === item.id ? "chip active" : "chip"} aria-pressed={periodo === item.id} onClick={() => onPeriodo(item.id)}>
            {item.rotulo}
          </button>
        ))}
      </div>
      {trimestral === true && <span className="section-hint">por trimestre</span>}
    </div>
  );
}
