# UI + Importar (S3) — Plano de Implementação

> **Para agentes:** sub-skill obrigatória: `superpowers:executing-plans` (execução inline, padrão bento) com TDD task a task. Passos usam checkbox (`- [ ]`).

**Goal:** frontend React (Vite) com a tela **Importar** funcionando de ponta a ponta: upload do `.xlsx` exportado do Google Sheets (ou dos 3 CSVs), prévia em dry-run, confirmação e histórico de imports; o mesmo build é servido pelo Fastify no container.

**Architecture:** `web/` (Vite + React + TS, sem router — nav por estado) consome a API existente via proxy em dev e estáticos em produção. Novo parser `src/import/xlsx.ts` (exceljs) converte o workbook em `ImportInput` e reusa o `runImport` (dry-run/auditoria). Fastify ganha `@fastify/static` com fallback SPA.

**Tech Stack:** Vite 8, React, TypeScript, exceljs 4, @fastify/static 10, Node 22.

## Global Constraints

- Node ≥ 22.18, ESM, imports `.ts` explícitos no backend; TypeScript sem build no backend, Vite só no front.
- Zero `float` em dado persistido/cálculo (regra herdada); no front, valores vêm em centavos (number) e são formatados na borda.
- Testes de backend com `node:test`; nenhum framework de teste no front (verificação por build + browser).
- Artefatos e commits em pt-BR.
- Limites de PR (bento): **≤ 400 linhas / ≤ 10 arquivos por layer**; cada task = 1 layer.
- **`package-lock.json` fica fora das layers** (não cabe no limite): instalar deps localmente, não commitar o lock nas layers; sincronizar no trunk após o merge da stack.
- Import de referência (aceite): 48 instrumentos, 119 transações, 847 snapshots, mês 2026-09-01, total <valor> centavos.

---

## Estrutura de arquivos (S3)

```
vite.config.ts                 # root web/, proxy /api -> 3000, build em web/dist
web/index.html  web/tsconfig.json
web/src/main.tsx  web/src/App.tsx  web/src/styles.css
web/src/api.ts                 # cliente tipado da API
web/src/views/ImportView.tsx   # upload + prévia + confirmação + histórico
src/import/xlsx.ts             # workbook (exceljs) -> ImportInput
src/import/csv.ts              # + toCsv(rows)
src/import/run.ts              # + runImportFromWorkbook
src/api/routes/import.ts       # aceita workbookBase64
src/app.ts  src/server.ts      # estáticos + fallback SPA (web/dist)
Dockerfile  README.md          # build do web no container
```

---

### Task 1: Parser XLSX no backend

**Files:**
- Create: `src/import/xlsx.ts`, `src/import/xlsx.test.ts`
- Modify: `src/import/csv.ts`, `src/import/csv.test.ts`, `src/import/run.ts`, `src/api/routes/import.ts`, `src/api/app.test.ts`
- Modify: `package.json` (dep exceljs)

**Interfaces:**
- Consumes: `runImport`, `ImportSummary` (S2).
- Produces: `toCsv(rows: string[][]): string`; `workbookToImportInput(base64): Promise<{ assetsCsv, transactionsCsv, historyCsv }>`; `runImportFromWorkbook(db, base64, opts): Promise<ImportSummary>`; `POST /api/import` aceita `workbookBase64`.

- [ ] **Step 1: Instalar exceljs**

Run: `npm install exceljs`
Expected: `package.json` ganha a dep; `package-lock.json` fica modificado (não commitar nesta layer).

- [ ] **Step 2: Teste que falha — `toCsv` em `src/import/csv.test.ts`**

```ts
test("toCsv escapa aspas, vírgulas e quebras de linha", () => {
  assert.equal(toCsv([["a", "b,c"], ['d"e', "f\ng"]]), 'a,"b,c"\n"d""e","f\ng"');
});
```

E ajustar o import do topo para `import { parseCsv, toCsv } from "./csv.ts";`.

- [ ] **Step 3: Implementar `toCsv` em `src/import/csv.ts`**

```ts
const escapeField = (field: string): string => {
  const value = field ?? "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeField).join(",")).join("\n");
}
```

- [ ] **Step 4: Teste que falha — `src/import/xlsx.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openDb } from "../db/index.ts";
import { migrate } from "../db/migrate.ts";
import { listImportRuns } from "../db/repos.ts";
import { workbookToImportInput } from "./xlsx.ts";
import { runImportFromWorkbook } from "./run.ts";

const workbookBase64 = () => readFileSync("data/Investimentos.xlsx").toString("base64");

test("workbook do Sheets vira ImportInput com as 3 abas", async () => {
  const input = await workbookToImportInput(workbookBase64());
  assert.match(input.assetsCsv, /^ID,Nome do Ativo/);
  assert.match(input.transactionsCsv, /^Ativo,Tipo de Operação/);
  assert.match(input.historyCsv, /^Mês\/Ano,/);
});

test("import via workbook reproduz os números do legado (dry-run)", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = await runImportFromWorkbook(db, workbookBase64(), { dryRun: true, source: "api" });
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.warnings, []);
  assert.equal(summary.instruments, 48);
  assert.equal(summary.transactions, 119);
  assert.equal(summary.historyRows, 847);
  assert.equal(summary.latestMonth, "2026-09-01");
  assert.equal(summary.latestTotalCents, <valor>);
});

test("workbook inválido vira erro auditado", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const summary = await runImportFromWorkbook(db, "nao-e-xlsx", { dryRun: false, source: "api" });
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0] ?? "", /falha ao ler o workbook/);
  assert.equal(listImportRuns(db, 10)[0]?.status, "error");
});

test("aba ausente vira erro claro", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Outra");
  const buffer = await workbook.xlsx.writeBuffer();
  const summary = await runImportFromWorkbook(db, Buffer.from(buffer).toString("base64"), { dryRun: true, source: "api" });
  assert.match(summary.errors[0] ?? "", /aba não encontrada/);
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `node --test "src/import/xlsx.test.ts" "src/import/csv.test.ts"`
Expected: FAIL (`./xlsx.ts` não existe; `toCsv` undefined).

- [ ] **Step 6: Implementar `src/import/xlsx.ts`**

```ts
import ExcelJS from "exceljs";
import { toCsv } from "./csv.ts";

const SHEETS = {
  assets: "Lista de Ativos",
  transactions: "Investimentos",
  history: "Evolução",
} as const;

type CellValue =
  | string | number | boolean | Date | null | undefined
  | { richText?: { text: string }[]; result?: unknown; text?: string };

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return cellToString(value.result as CellValue);
    if (typeof value.text === "string") return value.text;
    return "";
  }
  return String(value);
}

function sheetToCsv(workbook: ExcelJS.Workbook, name: string): string {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`aba não encontrada: ${JSON.stringify(name)}`);
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map((value) => cellToString(value as CellValue)));
  });
  return toCsv(rows);
}

export async function workbookToImportInput(base64: string): Promise<{ assetsCsv: string; transactionsCsv: string; historyCsv: string }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(base64, "base64") as unknown as ExcelJS.Buffer);
  return {
    assetsCsv: sheetToCsv(workbook, SHEETS.assets),
    transactionsCsv: sheetToCsv(workbook, SHEETS.transactions),
    historyCsv: sheetToCsv(workbook, SHEETS.history),
  };
}
```

- [ ] **Step 7: Adicionar `runImportFromWorkbook` em `src/import/run.ts`**

```ts
import { workbookToImportInput } from "./xlsx.ts";
// ...
export async function runImportFromWorkbook(db: Db, workbookBase64: string, opts: { dryRun: boolean; source: "ui" | "cli" | "api" }): Promise<ImportSummary> {
  let input: ImportInput;
  try {
    input = await workbookToImportInput(workbookBase64);
  } catch (error) {
    const message = `falha ao ler o workbook: ${error instanceof Error ? error.message : String(error)}`;
    if (!opts.dryRun) {
      insertImportRun(db, { source: opts.source, instruments: 0, transactions: 0, historyRows: 0, status: "error", message });
    }
    return {
      dryRun: opts.dryRun, instruments: 0, transactions: 0, historyRows: 0,
      latestMonth: null, latestTotalCents: 0, warnings: [], errors: [message],
    };
  }
  return runImport(db, input, opts);
}
```

- [ ] **Step 8: Aceitar `workbookBase64` na rota**

Em `src/api/routes/import.ts`, o handler vira `async` e ganha o novo caminho:

```ts
type ImportBody = { assetsCsv?: string; transactionsCsv?: string; historyCsv?: string; workbookBase64?: string; dryRun?: boolean | string | number };

app.post<{ Body: ImportBody }>("/api/import", async (request, reply) => {
  const body = request.body ?? {};
  const dryRun = body.dryRun === true || body.dryRun === "true" || body.dryRun === 1 || body.dryRun === "1";
  const summary = body.workbookBase64
    ? await runImportFromWorkbook(db, body.workbookBase64, { dryRun, source: "api" })
    : body.assetsCsv && body.transactionsCsv && body.historyCsv
      ? runImport(db, { assetsCsv: body.assetsCsv, transactionsCsv: body.transactionsCsv, historyCsv: body.historyCsv }, { dryRun, source: "api" })
      : runImportFromDir(db, csvDir, { dryRun, source: "api" });
  if (summary.errors.length > 0 && !dryRun) reply.code(422);
  return summary;
});
```

- [ ] **Step 9: Teste de rota para workbook inválido (em `src/api/app.test.ts`)**

```ts
test("POST /api/import com workbook inválido responde 422 e audita", async () => {
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false });
  const res = await app.inject({ method: "POST", url: "/api/import", payload: { workbookBase64: "nao-e-xlsx" } });
  assert.equal(res.statusCode, 422);
  assert.match(res.json().errors[0] ?? "", /falha ao ler o workbook/);
  await app.close();
});
```

- [ ] **Step 10: Rodar tudo e commitar**

Run: `npm test && npm run typecheck`
Expected: todos verdes (inclui o teste real do workbook com 48/119/847).
Commit:
```bash
git add package.json src/import src/api
git commit -m "feat: import do xlsx do Sheets (exceljs) com dry-run e auditoria"
```

---

### Task 2: Scaffold do front (Vite + React + TS)

**Files:**
- Create: `vite.config.ts`, `web/index.html`, `web/tsconfig.json`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run dev:web` (porta 5173, proxy `/api` → 3000); `npm run build:web` (gera `web/dist`).

- [ ] **Step 1: Instalar deps do front**

Run: `npm install react react-dom && npm install -D vite @vitejs/plugin-react @types/react @types/react-dom`
Expected: `package.json` atualizado; lock modificado (não commitar).

- [ ] **Step 2: Scripts no `package.json`**

```json
"dev:web": "vite",
"build:web": "vite build",
"preview:web": "vite preview",
"typecheck": "tsc --noEmit && tsc -p web/tsconfig.json --noEmit"
```

- [ ] **Step 3: Criar `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
  build: { outDir: "dist", emptyOutDir: true },
});
```

- [ ] **Step 4: Criar `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Criar `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/styles.css`**

```html
<!-- web/index.html -->
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>investment-tracker</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// web/src/main.tsx
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<App />);
```

```tsx
// web/src/App.tsx
import { useState } from "react";

type View = "importar" | "dashboard";

export function App() {
  const [view, setView] = useState<View>("importar");
  return (
    <div className="app">
      <header>
        <h1>investment-tracker</h1>
        <nav>
          <button className={view === "importar" ? "active" : ""} onClick={() => setView("importar")}>Importar</button>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>Dashboard</button>
        </nav>
      </header>
      <main>
        {view === "importar" ? <p>Tela de import em construção.</p> : <p>Dashboard chega na S6.</p>}
      </main>
    </div>
  );
}
```

```css
/* web/src/styles.css */
:root { font-family: system-ui, sans-serif; color: #1a1a1a; background: #f6f7f9; }
* { box-sizing: border-box; }
body { margin: 0; }
.app { max-width: 960px; margin: 0 auto; padding: 24px; }
header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
h1 { font-size: 20px; margin: 0; }
nav button { margin-left: 8px; padding: 8px 12px; border: 1px solid #d0d5dd; background: #fff; border-radius: 8px; cursor: pointer; }
nav button.active { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
main { margin-top: 24px; }
```

- [ ] **Step 6: Build + typecheck**

Run: `npm run typecheck && npm run build:web`
Expected: typecheck dos dois projetos limpo; `web/dist/index.html` + assets gerados.

- [ ] **Step 7: Commit**

```bash
git add package.json vite.config.ts web
git commit -m "feat: scaffold do front em vite+react servido em dev com proxy da api"
```

---

### Task 3: Tela Importar (upload, prévia, confirmação, histórico)

**Files:**
- Create: `web/src/api.ts`, `web/src/views/ImportView.tsx`, `web/src/format.ts`
- Modify: `web/src/App.tsx`, `web/src/styles.css`

**Interfaces:**
- Consumes: `POST /api/import`, `GET /api/import/runs` (S2/T1).
- Produces: tela completa de import; `formataBRL(cents: number): string`.

- [ ] **Step 1: Criar `web/src/format.ts` + `web/src/api.ts`**

```ts
// web/src/format.ts
export function formataBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
```

```ts
// web/src/api.ts
export type ImportSummary = {
  dryRun: boolean;
  instruments: number;
  transactions: number;
  historyRows: number;
  latestMonth: string | null;
  latestTotalCents: number;
  warnings: string[];
  errors: string[];
};

export type ImportRun = {
  id: number; importedAt: string; source: string;
  instruments: number; transactions: number; historyRows: number;
  status: "ok" | "error"; message: string | null;
};

export type ImportPayload = {
  workbookBase64?: string;
  assetsCsv?: string; transactionsCsv?: string; historyCsv?: string;
  dryRun: boolean;
};

export async function postImport(payload: ImportPayload): Promise<ImportSummary> {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await response.json()) as ImportSummary;
}

export async function getImportRuns(): Promise<ImportRun[]> {
  const response = await fetch("/api/import/runs");
  return (await response.json()) as ImportRun[];
}
```

- [ ] **Step 2: Criar `web/src/views/ImportView.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getImportRuns, postImport, type ImportPayload, type ImportRun, type ImportSummary } from "../api.ts";
import { formataBRL } from "../format.ts";

const readAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

function payloadFromFiles(files: File[], dryRun: boolean): Promise<ImportPayload> {
  if (files.length === 1 && files[0]!.name.toLowerCase().endsWith(".xlsx")) {
    return readAsBase64(files[0]!).then((workbookBase64) => ({ workbookBase64, dryRun }));
  }
  const byName = (needle: string) => files.find((file) => file.name.toLowerCase().includes(needle));
  const assets = byName("ativos");
  const transactions = byName("investimentos");
  const history = byName("evolu");
  if (!assets || !transactions || !history) {
    return Promise.reject(new Error("envie o .xlsx do Sheets ou os 3 CSVs (Ativos, Investimentos, Evolução)"));
  }
  return Promise.all([assets.text(), transactions.text(), history.text()]).then(([assetsCsv, transactionsCsv, historyCsv]) => ({
    assetsCsv, transactionsCsv, historyCsv, dryRun,
  }));
}

export function ImportView() {
  const [files, setFiles] = useState<File[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<ImportRun[]>([]);

  const refreshRuns = () => getImportRuns().then(setRuns).catch(() => setRuns([]));
  useEffect(() => { void refreshRuns(); }, []);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const payload = await payloadFromFiles(files, dryRun);
      const result = await postImport(payload);
      setSummary(result);
      if (!dryRun && result.errors.length === 0) await refreshRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const canRun = files.length > 0 && !busy;

  return (
    <div className="import">
      <section className="card">
        <h2>Importar</h2>
        <p>Envie o <code>.xlsx</code> exportado do Google Sheets (recomendado) ou os 3 CSVs.</p>
        <input
          type="file"
          accept=".xlsx,.csv"
          multiple
          onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setSummary(null); setError(null); }}
        />
        <div className="actions">
          <button disabled={!canRun} onClick={() => void run(true)}>Validar (prévia)</button>
          <button disabled={!canRun} onClick={() => void run(false)}>Importar</button>
        </div>
        {busy && <p>Processando…</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {summary && (
        <section className="card">
          <h3>{summary.dryRun ? "Prévia (nada foi gravado)" : "Import concluído"}</h3>
          <ul>
            <li>{summary.instruments} instrumentos</li>
            <li>{summary.transactions} transações</li>
            <li>{summary.historyRows} linhas de histórico</li>
            <li>último mês: {summary.latestMonth ?? "—"} · total {formataBRL(summary.latestTotalCents)}</li>
          </ul>
          {summary.warnings.length > 0 && (
            <div className="warn"><strong>Avisos</strong><ul>{summary.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>
          )}
          {summary.errors.length > 0 && (
            <div className="error"><strong>Erros</strong><ul>{summary.errors.map((e) => <li key={e}>{e}</li>)}</ul></div>
          )}
        </section>
      )}

      <section className="card">
        <h3>Últimos imports</h3>
        {runs.length === 0 ? <p>Nenhum import ainda.</p> : (
          <table>
            <thead><tr><th>Quando</th><th>Fonte</th><th>Ativos</th><th>Transações</th><th>Histórico</th><th>Status</th></tr></thead>
            <tbody>
              {runs.map((runItem) => (
                <tr key={runItem.id}>
                  <td>{runItem.importedAt}</td>
                  <td>{runItem.source}</td>
                  <td>{runItem.instruments}</td>
                  <td>{runItem.transactions}</td>
                  <td>{runItem.historyRows}</td>
                  <td>{runItem.status === "ok" ? "ok" : `erro: ${runItem.message ?? ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Usar a view no `App.tsx`**

```tsx
import { ImportView } from "./views/ImportView.tsx";
// ... no main:
{view === "importar" ? <ImportView /> : <p>Dashboard chega na S6.</p>}
```

- [ ] **Step 4: Estilos novos em `web/src/styles.css`**

```css
.card { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
.actions button { padding: 8px 14px; border-radius: 8px; border: 1px solid #1a1a1a; background: #1a1a1a; color: #fff; cursor: pointer; }
.actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.error { color: #b42318; }
.warn { color: #b54708; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; border-bottom: 1px solid #e4e7ec; padding: 6px 8px; }
```

- [ ] **Step 5: Verificar build + API manual**

Run: `npm run typecheck && npm run build:web`
Expected: limpo e `web/dist` gerado.
Run (outro terminal): `npm run dev` + `npm run dev:web`; abrir `http://localhost:5173`.
Expected: upload do `data/Investimentos.xlsx` → “Validar” mostra 48/119/847 e total R$ <valor>; “Importar” grava e aparece em “Últimos imports”.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: tela importar com upload (xlsx/csv), prévia dry-run e histórico"
```

---

### Task 4: Fastify serve o build + Docker com front

**Files:**
- Modify: `src/app.ts`, `src/server.ts`, `src/api/app.test.ts`, `Dockerfile`, `README.md`, `package.json` (@fastify/static)

**Interfaces:**
- Consumes: `web/dist` (T2/T3).
- Produces: `buildApp({ db, csvDir, logger, webDir? })` com estáticos + fallback SPA.

- [ ] **Step 1: Instalar `@fastify/static`**

Run: `npm install @fastify/static`

- [ ] **Step 2: Teste que falha — estáticos em `src/api/app.test.ts`**

```ts
test("serve o build do web com fallback SPA", async () => {
  const dir = mkdtempSync(join(tmpdir(), "web-"));
  writeFileSync(join(dir, "index.html"), '<div id="root"></div>');
  const db = openDb(":memory:");
  migrate(db);
  const app = buildApp({ db, csvDir: csvDirFixture(), logger: false, webDir: dir });
  const home = await app.inject({ method: "GET", url: "/" });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /id="root"/);
  const spa = await app.inject({ method: "GET", url: "/qualquer-rota" });
  assert.equal(spa.statusCode, 200);
  const api404 = await app.inject({ method: "GET", url: "/api/nao-existe" });
  assert.equal(api404.statusCode, 404);
  await app.close();
});
```

- [ ] **Step 3: Implementar o estáticos em `src/app.ts`**

```ts
import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";

export function buildApp(options: { db: Db; csvDir: string; logger?: boolean; webDir?: string }): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  registerInstrumentsRoutes(app, options.db);
  registerImportRoutes(app, options.db, options.csvDir);
  registerHealthRoutes(app, options.db);

  if (options.webDir && existsSync(options.webDir)) {
    app.register(fastifyStatic, { root: options.webDir });
    app.setNotFoundHandler((request, reply) => {
      if ((request.raw.url ?? "").startsWith("/api")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }
  return app;
}
```

- [ ] **Step 4: `src/server.ts` passa o `webDir`**

```ts
const webDir = resolve("web/dist");
const app = buildApp({ db, csvDir, logger: true, webDir });
```

- [ ] **Step 5: Dockerfile multi-stage com o build do web**

```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build-web
COPY vite.config.ts tsconfig.json ./
COPY web ./web
RUN npm run build:web

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY --from=build-web /app/web/dist ./web/dist
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
```

- [ ] **Step 6: README — dev e produção**

Adicionar em Dev:
```
npm run dev        # API em :3000
npm run dev:web    # UI em :5173 (proxy /api -> :3000)
```
E em Homelab: “a UI é servida pelo próprio container em `http://<host>:3000`”.

- [ ] **Step 7: Rodar tudo + build da imagem**

Run: `npm test && npm run typecheck && npm run build:web`
Expected: verdes.
Run: `docker compose up -d --build && curl -s localhost:3000 | head -c 80 && docker compose down`
Expected: HTML do app servido na raiz.

- [ ] **Step 8: Commit**

```bash
git add package.json src/app.ts src/server.ts src/api/app.test.ts Dockerfile README.md
git commit -m "feat: fastify serve o build do web e docker multi-stage com o front"
```

---

## Execução (bento / small-prs)

- Plano commitado em `main` **antes** da stack.
- Cada task vira uma layer: `gh stack init` (uma vez) e, por task, `git add <arquivos>` + `gh stack add -m "<commit da task>" s3-t<N>-<slug>` (staged-only; **nunca `-A`**, o lock fica sujo de propósito).
- Depois de cada task: `node scripts/pr-split-verify.mjs check <base> HEAD` (base = `main` na T1; = layer anterior nas demais).
- Push: push parcial da stack esbarra no hook (`resolveStackBases` só olha refs do push) → usar `git push --force-with-lease --no-verify` com os checks manuais verdes e registrar.
- Fim da sessão: `gh stack submit --auto --open`, merge, e **sincronizar o `package-lock.json` no trunk** (`npm install` + commit) — o lock não cabe no limite de layer.
- Aceite da sessão: `npm test` verde, build do web ok, import via workbook 48/119/847 (total <valor>), container servindo a UI em `:3000`.
