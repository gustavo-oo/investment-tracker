import { test } from "node:test";
import assert from "node:assert/strict";
import { createCvmSwbSource, parseQuotaSeries } from "./cvm-swb.ts";
import type { FetchLike } from "./types.ts";

const GET_HTML = `<html><body><form name="iForm" method="post" action="./CPublicaInfdiario.aspx?PK_PARTIC=253210&amp;PK_SUBCLASSE=-1">
<input type="hidden" name="__EVENTTARGET" value="" />
<input type="hidden" name="__VIEWSTATE" value="VS-TOKEN" />
<input type="hidden" name="__VIEWSTATEGENERATOR" value="GEN-TOKEN" />
<input type="hidden" name="__EVENTVALIDATION" value="EV-TOKEN" />
</form></body></html>`;

const POST_HTML = `<html><body><table>
<tr><td>Dia</td><td>Quota (R$)</td><td>Captação no Dia (R$)</td></tr>
<tr><td>01</td><td>1,205210301515</td><td>201.034,69</td></tr>
<tr><td>02</td><td>1,206947830859</td><td>199.829,41</td></tr>
<tr><td>03</td><td></td><td></td></tr>
<tr><td>04</td><td>1,209588321963</td><td>40.972,64</td></tr>
<tr><td>31</td><td>9,999999999999</td><td>0,00</td></tr>
</table></body></html>`;

type Call = { url: string; init?: RequestInit };

const queueFetch = (calls: Call[], responses: Array<() => Response>): FetchLike =>
  async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error("fetch inesperado");
    return next();
  };

const ok = (body: string) => () => new Response(body, { status: 200, headers: { "set-cookie": "ASP.NET_SessionId=abc; path=/" } });

test("parseQuotaSeries lê o layout calendário e ignora dia vazio e data inválida", () => {
  assert.deepEqual(parseQuotaSeries(POST_HTML, 2026, 2), [
    { date: "2026-02-01", quotaE12: 1_205_210_301_515n },
    { date: "2026-02-02", quotaE12: 1_206_947_830_859n },
    { date: "2026-02-04", quotaE12: 1_209_588_321_963n },
  ]);
});

test("cvm-swb faz GET + POST por mês e devolve a série do símbolo", async () => {
  const calls: Call[] = [];
  const source = createCvmSwbSource({
    fetchImpl: queueFetch(calls, [ok(GET_HTML), ok(POST_HTML)]),
    now: () => new Date("2026-09-20T10:00:00-03:00"),
  });
  const quotas = await source.fetchDaily(["253210"], "2026-09-01", "2026-09-30");
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /PK_PARTIC=253210/);
  assert.equal(calls[1]!.init?.method, "POST");
  assert.match(String(calls[1]!.init?.body), /ddComptc=09%2F2026/);
  assert.match(String(calls[1]!.init?.body), /__VIEWSTATE=VS-TOKEN/);
  const headers = calls[1]!.init?.headers as Record<string, string>;
  assert.equal(headers["Origin"], "https://cvmweb.cvm.gov.br");
  assert.match(headers["Cookie"] ?? "", /ASP\.NET_SessionId=abc/);
  assert.deepEqual(quotas, [
    { symbol: "253210", date: "2026-09-01", quotaE12: 1_205_210_301_515n },
    { symbol: "253210", date: "2026-09-02", quotaE12: 1_206_947_830_859n },
    { symbol: "253210", date: "2026-09-04", quotaE12: 1_209_588_321_963n },
  ]);
});

test("cvm-swb filtra a janela from/to", async () => {
  const source = createCvmSwbSource({ fetchImpl: queueFetch([], [ok(GET_HTML), ok(POST_HTML)]) });
  const quotas = await source.fetchDaily(["253210"], "2026-09-02", "2026-09-03");
  assert.deepEqual(quotas, [{ symbol: "253210", date: "2026-09-02", quotaE12: 1_206_947_830_859n }]);
});

test("cvm-swb cacheia o mês por 6h e itera vários meses", async () => {
  const calls: Call[] = [];
  const fetchImpl = queueFetch(calls, [ok(GET_HTML), ok(POST_HTML)]);
  const source = createCvmSwbSource({ fetchImpl, now: () => new Date("2026-09-20T10:00:00-03:00") });
  await source.fetchDaily(["253210"], "2026-09-01", "2026-09-30");
  await source.fetchDaily(["253210"], "2026-09-15", "2026-09-30");
  assert.equal(calls.length, 2, "segunda chamada usa o cache");
  const multi = createCvmSwbSource({ fetchImpl: queueFetch(calls, [ok(GET_HTML), ok(POST_HTML), ok(GET_HTML), ok(POST_HTML)]) });
  await multi.fetchDaily(["253210"], "2026-08-01", "2026-09-30");
  assert.equal(calls.length, 6, "dois meses = quatro requests");
});

test("cvm-swb falha em HTTP ruim, viewstate ausente e página de erro", async () => {
  const http = createCvmSwbSource({ fetchImpl: async () => new Response("nope", { status: 502 }) });
  await assert.rejects(() => http.fetchDaily(["253210"], "2026-09-01", "2026-09-30"), /cvm-swb HTTP 502/);

  const semViewstate = createCvmSwbSource({ fetchImpl: async () => new Response("<html>vazio</html>", { status: 200 }) });
  await assert.rejects(() => semViewstate.fetchDaily(["253210"], "2026-09-01", "2026-09-30"), /sem VIEWSTATE/);

  const erro = createCvmSwbSource({ fetchImpl: queueFetch([], [ok(GET_HTML), ok("<html>Erro em Página do Sistema</html>")]) });
  await assert.rejects(() => erro.fetchDaily(["253210"], "2026-09-01", "2026-09-30"), /página de erro/);
});
