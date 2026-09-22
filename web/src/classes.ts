import type { PortfolioPosition } from "./api.ts";

export type Classe = "rf" | "rv" | "pension";

export const ORDEM_CLASSE: Classe[] = ["rf", "rv", "pension"];

export const ROTULO_CLASSE: Record<Classe, string> = {
  rf: "Renda fixa",
  rv: "Renda variável",
  pension: "Previdência",
};

/** Classe econômica: ETF de renda fixa conta como renda fixa, não como renda variável. */
export function classeDe(posicao: Pick<PortfolioPosition, "kind" | "category">): Classe {
  if (posicao.kind === "pension") return "pension";
  if (posicao.kind === "fixed_income" || posicao.category === "etf_fixed") return "rf";
  return "rv";
}
