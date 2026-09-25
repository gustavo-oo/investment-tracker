import type { PortfolioPosition } from "./api.ts";

export type Classe = "rf" | "rv" | "pension";

export const ORDEM_CLASSE: Classe[] = ["rf", "rv", "pension"];

export const ROTULO_CLASSE: Record<Classe, string> = {
  rf: "Renda Fixa",
  rv: "Renda Variável",
  pension: "Previdência",
};

/** Classe econômica: ETF de renda fixa conta como renda fixa, não como renda variável. */
export function classeDe(posicao: Pick<PortfolioPosition, "kind" | "category">): Classe {
  if (posicao.kind === "pension") return "pension";
  if (posicao.kind === "fixed_income" || posicao.category === "etf_fixed") return "rf";
  return "rv";
}

/** Cor de cada classe econômica (cartões, cabeçalhos de grupo e gaveta). */
export const COR_DA_CLASSE: Record<Classe, string> = {
  rf: "#3F6B52",
  rv: "#47657F",
  pension: "#9A6A2A",
};
