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

export function formataDataHora(sqliteUtc: string): string {
  const parsed = new Date(`${sqliteUtc.replace(" ", "T")}Z`);
  return Number.isNaN(parsed.getTime()) ? sqliteUtc : formatadorDataHora.format(parsed);
}

const NOMES_MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

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
  cdb: "CDB", lca: "LCA", selic: "Tesouro Selic", etf_fixed: "ETF RF", etf_equity: "ETF RV", pension_ipca: "Previdência",
};

export function formataCategoria(categoria: string): string {
  return ROTULO_CATEGORIA[categoria] ?? categoria;
}

export function mesDeslocado(mes: string, delta: number): string {
  const [ano = 0, numero = 1] = mes.split("-").map(Number);
  const total = ano * 12 + (numero - 1) + delta;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String(((total % 12) + 12) % 12 + 1).padStart(2, "0")}`;
}
