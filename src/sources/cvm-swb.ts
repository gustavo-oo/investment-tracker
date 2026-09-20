import { monthRange } from "../domain/dates.ts";
import { QUOTA_SCALE, parseDecimal } from "../domain/money.ts";
import type { FetchLike, FundQuota, FundQuotaSource } from "./types.ts";

const BASE = "https://cvmweb.cvm.gov.br/SWB/Sistemas/SCW/CPublica/InfDiario/CPublicaInfdiario.aspx";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

export type CvmSwbDeps = { fetchImpl?: FetchLike; now?: () => Date };

export type ParsedQuota = { date: string; quotaE12: bigint };

const stripTags = (html: string): string =>
  html.replace(/<[^>]+>/g, " ").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();

const hiddenField = (html: string, name: string): string =>
  html.match(new RegExp(`name=['"]${name}['"][^>]*value=['"]([^'"]*)['"]`, "i"))?.[1] ?? "";

const isErrorPage = (html: string): boolean =>
  /Erro em P[áa]gina do Sistema/i.test(html) || /Ocorreu um erro de processamento no servidor\./i.test(html);

/** Linhas do layout calendário: cells[0] = dia, cells[1] = cota; dias vazios e datas inválidas são descartados. */
export function parseQuotaSeries(html: string, year: number, month: number): ParsedQuota[] {
  const mm = String(month).padStart(2, "0");
  const series: ParsedQuota[] = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(row[1]!.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi))
      .map((cell) => stripTags(cell[1]!))
      .filter((cell) => cell !== "");
    if (cells.length < 2 || !/^\d{1,2}$/.test(cells[0]!)) continue;
    const day = Number(cells[0]);
    const date = `${year}-${mm}-${String(day).padStart(2, "0")}`;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) continue;
    let quotaE12: bigint;
    try {
      quotaE12 = parseDecimal(cells[1]!, QUOTA_SCALE);
    } catch {
      continue;
    }
    if (quotaE12 <= 0n) continue;
    series.push({ date, quotaE12 });
  }
  return series.sort((a, b) => a.date.localeCompare(b.date));
}

export function createCvmSwbSource(deps: CvmSwbDeps = {}): FundQuotaSource {
  const fetchImpl: FetchLike = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const cache = new Map<string, { at: number; rows: ParsedQuota[] }>();

  const fetchMonth = async (symbol: string, year: number, month: number): Promise<ParsedQuota[]> => {
    const key = `${symbol}:${year}-${String(month).padStart(2, "0")}`;
    const cached = cache.get(key);
    if (cached && now().getTime() - cached.at < CACHE_TTL_MS) return cached.rows;

    const url = `${BASE}?PK_PARTIC=${encodeURIComponent(symbol)}&PK_SUBCLASSE=-1`;
    const getResponse = await fetchImpl(url, { headers: BROWSER_HEADERS });
    if (!getResponse.ok) throw new Error(`cvm-swb HTTP ${getResponse.status} no GET de ${symbol}`);
    const getHtml = await getResponse.text();
    if (isErrorPage(getHtml)) throw new Error(`cvm-swb página de erro no GET de ${symbol}`);
    const viewState = hiddenField(getHtml, "__VIEWSTATE");
    const eventValidation = hiddenField(getHtml, "__EVENTVALIDATION");
    if (viewState === "" || eventValidation === "") throw new Error(`cvm-swb sem VIEWSTATE/EVENTVALIDATION para ${symbol}`);

    const cookie = (getResponse.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const form = new URLSearchParams({
      __EVENTTARGET: "ddComptc",
      __EVENTARGUMENT: "",
      __LASTFOCUS: "",
      __VIEWSTATE: viewState,
      __VIEWSTATEGENERATOR: hiddenField(getHtml, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: eventValidation,
      ddComptc: `${String(month).padStart(2, "0")}/${year}`,
    });
    const headers: Record<string, string> = {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://cvmweb.cvm.gov.br",
      Referer: url,
    };
    if (cookie !== "") headers["Cookie"] = cookie;

    const postResponse = await fetchImpl(url, { method: "POST", headers, body: form.toString() });
    if (!postResponse.ok) throw new Error(`cvm-swb HTTP ${postResponse.status} no POST de ${symbol} ${year}-${String(month).padStart(2, "0")}`);
    const postHtml = await postResponse.text();
    if (isErrorPage(postHtml)) throw new Error(`cvm-swb página de erro no POST de ${symbol} ${year}-${String(month).padStart(2, "0")}`);

    const rows = parseQuotaSeries(postHtml, year, month);
    cache.set(key, { at: now().getTime(), rows });
    return rows;
  };

  return {
    id: "cvm-swb",
    async fetchDaily(symbols, from, to) {
      const months = monthRange(from.slice(0, 7), to.slice(0, 7));
      const quotas: FundQuota[] = [];
      for (const symbol of symbols) {
        for (const month of months) {
          const [year = 0, monthNumber = 1] = month.split("-").map(Number);
          const rows = await fetchMonth(symbol, year, monthNumber);
          for (const row of rows) {
            if (row.date < from || row.date > to) continue;
            quotas.push({ symbol, date: row.date, quotaE12: row.quotaE12 });
          }
        }
      }
      return quotas;
    },
  };
}
