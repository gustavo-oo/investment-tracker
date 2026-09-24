export function formataBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formataNumero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

const formatadorDataHora = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export function formataDataHora(valor: string): string {
  const parsed = new Date(/[TZ]/.test(valor) ? valor : `${valor.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? valor : formatadorDataHora.format(parsed);
}

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function formataData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}

export function formataMes(isoMes: string): string {
  const [ano, mes] = isoMes.split("-");
  const nome = NOMES_MES[Number(mes) - 1];
  return ano && nome ? `${nome}/${ano}` : isoMes;
}

export function formataTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

const ROTULO_FONTE: Record<string, string> = {
  ui: "Interface",
  cli: "CLI",
  api: "API",
};

export function formataFonte(fonte: string): string {
  return ROTULO_FONTE[fonte] ?? fonte;
}

const formatadorHora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

function parseTimestamp(value: string): Date | null {
  const parsed = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formataHora(value: string): string {
  const parsed = parseTimestamp(value);
  return parsed === null ? value : formatadorHora.format(parsed);
}

export function formataPercentual(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export function formataIndice(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export function formataQuantidade(e8: number): string {
  return (e8 / 1e8).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

const ROTULO_CATEGORIA: Record<string, string> = {
  cdb: "CDB", lca: "LCA", selic: "Tesouro Selic", etf_fixed: "ETF Renda Fixa", etf_equity: "ETF Renda Variável", pension_ipca: "Previdência",
};

export function formataCategoria(categoria: string): string {
  return ROTULO_CATEGORIA[categoria] ?? categoria;
}

export function mesDeslocado(mes: string, delta: number): string {
  const [ano = 0, numero = 1] = mes.split("-").map(Number);
  const total = ano * 12 + (numero - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String(((total % 12) + 12) % 12 + 1).padStart(2, "0")}`;
}

export function formataPercentualSinal(valor: number): string {
  const sinal = valor > 0 ? "+" : "";
  return `${sinal}${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export function formataPontosPercentuais(valor: number): string {
  const sinal = valor > 0 ? "+" : "";
  return `${sinal}${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.`;
}

export function formataJanela(from: string, to: string): string {
  return `${formataMes(from)} – ${formataMes(to)}`;
}

/** "1.234,56" | "1234,5" | "1234" → centavos; aceita 0; null se inválido. */
export function parseMoedaParaCents(texto: string): number | null {
  const limpo = texto.trim().replace(/R\$/g, "").replace(/\s+/g, "");
  const match = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(limpo);
  if (match === null) return null;
  const inteiro = (match[1] ?? "0").replace(/\./g, "");
  const centavos = ((match[2] ?? "") + "00").slice(0, 2);
  const cents = Number(BigInt(inteiro) * 100n + BigInt(centavos));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "105" | "105,5" | "100,0996" → 1050000/1055000/1000996 (escala e6, 100% = 1e6); null se inválido ou ≤ 0. */
export function parsePercentualParaE6(texto: string): number | null {
  const limpo = texto.trim().replace("%", "").replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(limpo)) return null;
  const [inteiro = "0", fracao = ""] = limpo.split(".");
  const e6 = Number(BigInt(inteiro) * 10_000n + BigInt((fracao + "0000").slice(0, 4)));
  return Number.isSafeInteger(e6) && e6 > 0 ? e6 : null;
}

/** "10,5" → 1050000000 (escala e8); null se inválido ou ≤ 0. */
export function parseQuantidadeE8(texto: string): number | null {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,8})?$/.test(limpo)) return null;
  const [inteiro = "0", fracao = ""] = limpo.split(".");
  const e8 = Number(BigInt(inteiro) * 100_000_000n + BigInt((fracao + "00000000").slice(0, 8)));
  return Number.isSafeInteger(e8) && e8 > 0 ? e8 : null;
}
