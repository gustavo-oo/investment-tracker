import { readFileSync } from "node:fs";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  const src = text.replace(/\r\n?/g, "\n");
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (inQuotes) throw new Error("CSV com aspas não fechadas");
  if (row.length > 0 || field !== "") { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function readCsv(path: string): string[][] {
  return parseCsv(readFileSync(path, "utf8"));
}
