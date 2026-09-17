import { test } from "node:test";
import assert from "node:assert/strict";
import { mapInstrumentRow, mapTransactionRow } from "./map.ts";

test("mapInstrumentRow: RF sem cota, sem ticker, com rate e benchmark", () => {
  const instrument = mapInstrumentRow([
    "CDB PagBank 112%:  02-07-26", "CDB PagBank 112%", "Renda Fixa", "CDB", "-", "PagBank",
    "2026-07-02 00:00:00", "CDI", "1.12", "Diário", "Ana", "Reserva",
  ]);
  assert.equal(instrument.id, "cdb-pagbank-112-02-07-26");
  assert.equal(instrument.legacyKey, "CDB PagBank 112%:  02-07-26");
  assert.equal(instrument.kind, "fixed_income");
  assert.equal(instrument.category, "cdb");
  assert.equal(instrument.ticker, null);
  assert.equal(instrument.quoteSource, null);
  assert.equal(instrument.rateE6, 1120000n);
  assert.equal(instrument.benchmark, "CDI");
  assert.equal(instrument.maturityDate, "2026-07-02");
});

test("mapInstrumentRow: ETF com ticker e previdência com cvm-swb", () => {
  const etf = mapInstrumentRow(["B5P211", "B5P211", "Renda Variável", "ETF - Renda Fixa", "B5P211", "Inter", "2026-01-01 00:00:00", "Nenhum", "1.0", "Diário", "Ana", "Longo prazo"]);
  assert.equal(etf.kind, "equity");
  assert.equal(etf.category, "etf_fixed");
  assert.equal(etf.ticker, "B5P211");
  assert.equal(etf.quoteSource, "yahoo");
  assert.equal(etf.benchmark, null);

  const prev = mapInstrumentRow(["253210", "Previdência", "Previdência PGBL", "IPCA - Previdência", "253210.0", "BTG", "2026-01-01 00:00:00", "Nenhum", "1.0", "Diário", "Ana", "Longo prazo"]);
  assert.equal(prev.kind, "pension");
  assert.equal(prev.quoteSource, "cvm-swb");
  assert.equal(prev.quoteSymbol, "253210");
  assert.equal(prev.ticker, null);
});

test("mapInstrumentRow normaliza benchmark para maiúsculas (Selic -> SELIC)", () => {
  const instrument = mapInstrumentRow(["X", "X", "Renda Fixa", "Selic", "-", "Inter", "2030-01-01 00:00:00", "Selic", "1.0", "Diário", "Ana", "Reserva"]);
  assert.equal(instrument.benchmark, "SELIC");
});

test("mapTransactionRow: bruto=Resultado, taxas, sinal da quantidade e NULL em RF", () => {
  const compraRf = mapTransactionRow(["CDB X", "Compra", "2025-04-23 00:00:00", "1176.16", "0.01", "1176.15", "1.0"], "fixed_income", 2);
  assert.equal(compraRf.kind, "BUY");
  assert.equal(compraRf.grossCents, 117615n);
  assert.equal(compraRf.feesCents, 1n);
  assert.equal(compraRf.quantityE8, null, "cota 1.0 fictícia vira NULL em RF");
  assert.equal(compraRf.legacyRow, 2);

  const compraEtf = mapTransactionRow(["B5P211", "Compra", "2025-06-04 00:00:00", "3951.11", "1.17", "3949.94", "41.0"], "equity", 3);
  assert.equal(compraEtf.quantityE8, 4100000000n);
  assert.equal(compraEtf.grossCents, 394994n);

  const venda = mapTransactionRow(["B5P211", "Resgate", "2026-08-01 00:00:00", "1000.00", "0.0", "1000.00", "10.0"], "equity", 4);
  assert.equal(venda.kind, "SELL");
  assert.equal(venda.quantityE8, -1000000000n, "saída é negativa");

  const prev = mapTransactionRow(["253210.0", "Compra", "2025-10-01 00:00:00", "1000.0", "0.0", "1000", "930.14877553"], "pension", 5);
  assert.equal(prev.instrumentId, "253210", "id normalizado sem .0");
  assert.equal(prev.quantityE8, 93014877553n);
});

test("mapInstrumentRow rejeita benchmark fora do CHECK do banco", () => {
  assert.throws(
    () => mapInstrumentRow(["X", "X", "Renda Fixa", "CDB", "-", "PagBank", "2030-01-01 00:00:00", "Prefixado", "1.0", "Diário", "Ana", "Reserva"]),
    /benchmark desconhecido/,
  );
});

test("mapTransactionRow rejeita valores negativos (CHECK gross/fees >= 0)", () => {
  assert.throws(
    () => mapTransactionRow(["X", "Compra", "2026-01-01 00:00:00", "0", "0", "-10.00", "1.0"], "fixed_income", 2),
    /valores negativos/,
  );
  assert.throws(
    () => mapTransactionRow(["X", "Compra", "2026-01-01 00:00:00", "0", "-1.00", "10.00", "1.0"], "fixed_income", 2),
    /valores negativos/,
  );
});
