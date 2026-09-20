export type Cents = bigint;
export type SharesE8 = bigint;
export type RateE12 = bigint;
export type MultiplierE6 = bigint;

export const CENTS = 100n;
export const SHARES_SCALE = 100_000_000n;
export const QUOTA_SCALE = 1_000_000_000_000n;
export const RATE_SCALE = 1_000_000_000_000n;
export const MULTIPLIER_SCALE = 1_000_000n;

/** Divisão inteira com arredondamento half-up (para longe do zero). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("divisão por zero");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const rounded = (n * 2n + d) / (d * 2n);
  return negative ? -rounded : rounded;
}

/** Multiplica dois valores escalonados mantendo a escala do resultado. */
export function mulScaled(a: bigint, b: bigint, scale: bigint): bigint {
  return divRoundHalfUp(a * b, scale);
}

/** Converte texto decimal ("1234.56", "1.234,56", "-35.196...") em inteiro escalonado. */
export function parseDecimal(text: string, scale: bigint): bigint {
  const clean = String(text).trim().replace(/R\$/g, "").replace(/\s+/g, "");
  if (clean === "" || clean === "-") throw new Error(`número vazio: ${JSON.stringify(text)}`);
  const negative = clean.startsWith("-");
  const body = clean.replace(/^[-+]/, "");
  const normalized = body.includes(",")
    ? body.replace(/\./g, "").replace(",", ".")
    : body;
  if (!/^\d*(\.\d*)?$/.test(normalized) || normalized === ".") {
    throw new Error(`número inválido: ${JSON.stringify(text)}`);
  }
  const digits = scale.toString().length - 1;
  const [intPart = "0", fracPart = ""] = normalized.split(".");
  const kept = (fracPart + "0".repeat(digits)).slice(0, digits);
  const nextDigit = fracPart.length > digits ? fracPart[digits] : "0";
  let value = BigInt(intPart === "" ? "0" : intPart) * scale + BigInt(kept === "" ? "0" : kept);
  if (nextDigit >= "5") value += 1n;
  return negative ? -value : value;
}

/** Formata centavos em pt-BR: 707484n -> "R$ 7.074,84". */
export function formatCents(value: Cents): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const int = abs / CENTS;
  const cents = (abs % CENTS).toString().padStart(2, "0");
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${intStr},${cents}`;
}

/** Converte bigint para number seguro em JSON (rejeita perda de precisão). */
export function toNumberSafe(value: bigint): number {
  const MAX = 9007199254740991n;
  if (value > MAX || value < -MAX) throw new Error(`valor fora do range seguro: ${value}`);
  return Number(value);
}
