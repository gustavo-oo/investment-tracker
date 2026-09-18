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
