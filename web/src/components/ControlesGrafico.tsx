import { PERIODOS, type Periodo } from "../periodos.ts";

export type Visao = "patrimonio" | "fluxos" | "rendimento";
export type SubAba = "mes" | "acumulado";

const VISOES: Array<{ id: Visao; rotulo: string }> = [
  { id: "patrimonio", rotulo: "Evolução do patrimônio" },
  { id: "fluxos", rotulo: "Aportes e resgates" },
  { id: "rendimento", rotulo: "Rendimento vs CDI e IPCA" },
];

export function SeletorVisao({ visao, onVisao }: { visao: Visao; onVisao: (visao: Visao) => void }) {
  return (
    <div className="chart-grupo" role="group" aria-label="Gráfico">
      {VISOES.map((item) => (
        <button key={item.id} type="button" className={visao === item.id ? "chip active" : "chip"} aria-pressed={visao === item.id} onClick={() => onVisao(item.id)}>
          {item.rotulo}
        </button>
      ))}
    </div>
  );
}

export function ControlePeriodo({ periodo, onPeriodo, trimestral }: {
  periodo: Periodo; onPeriodo: (periodo: Periodo) => void; trimestral?: boolean;
}) {
  return (
    <>
      <div className="chart-grupo" role="group" aria-label="Período">
        {PERIODOS.map((item) => (
          <button key={item.id} type="button" className={periodo === item.id ? "chip active" : "chip"} aria-pressed={periodo === item.id} onClick={() => onPeriodo(item.id)}>
            {item.rotulo}
          </button>
        ))}
      </div>
      {trimestral === true && <span className="section-hint">por trimestre</span>}
    </>
  );
}

export function ControleGranularidade({ subAba, onSubAba }: { subAba: SubAba; onSubAba: (subAba: SubAba) => void }) {
  return (
    <div className="chart-grupo" role="group" aria-label="Granularidade">
      <button type="button" className={subAba === "mes" ? "chip active" : "chip"} aria-pressed={subAba === "mes"} onClick={() => onSubAba("mes")}>Mês a mês</button>
      <button type="button" className={subAba === "acumulado" ? "chip active" : "chip"} aria-pressed={subAba === "acumulado"} onClick={() => onSubAba("acumulado")}>Acumulado</button>
    </div>
  );
}
