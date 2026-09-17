import type { InstrumentCategory, InstrumentKind } from "../domain/model.ts";

const KIND_BY_LEGACY_TYPE: Record<string, InstrumentKind> = {
  "Renda Fixa": "fixed_income",
  "Renda Variável": "equity",
  "Previdência PGBL": "pension",
};

const CATEGORY_BY_LEGACY_SUBTYPE: Record<string, InstrumentCategory> = {
  "CDB": "cdb",
  "LCA": "lca",
  "Selic": "selic",
  "ETF - Renda Fixa": "etf_fixed",
  "ETF - Renda Variável": "etf_equity",
  "IPCA - Previdência": "pension_ipca",
};

export function kindFromLegacy(type: string): InstrumentKind {
  const kind = KIND_BY_LEGACY_TYPE[type.trim()];
  if (!kind) throw new Error(`tipo desconhecido: ${JSON.stringify(type)}`);
  return kind;
}

export function categoryFromLegacy(subtype: string): InstrumentCategory {
  const category = CATEGORY_BY_LEGACY_SUBTYPE[subtype.trim()];
  if (!category) throw new Error(`subtipo desconhecido: ${JSON.stringify(subtype)}`);
  return category;
}

export function slugify(legacyKey: string): string {
  const slug = legacyKey
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") throw new Error(`id vazio após slugify: ${JSON.stringify(legacyKey)}`);
  return slug;
}

export function normalizeLegacyId(value: string): string {
  const trimmed = value.trim();
  return /^\d+\.0$/.test(trimmed) ? trimmed.slice(0, -2) : trimmed;
}
