import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { getRebalance, saveRebalance, type Rebalance } from "../api.ts";
import { formataBRL, formataPercentual, parseMoedaParaCents, parsePercentualParaE6 } from "../format.ts";

const ROTULOS: Record<string, string> = { rf: "Renda Fixa", rv: "Renda Variável" };
const SOMA_METAS = 1_000_000;

function textoDeE6(e6: number): string {
  return (e6 / 10_000).toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function textoDeCents(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RebalanceView({ reloadToken }: { reloadToken: number }) {
  const [dados, setDados] = useState<Rebalance | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [rfTexto, setRfTexto] = useState("");
  const [rvTexto, setRvTexto] = useState("");
  const [aporteTexto, setAporteTexto] = useState("");
  const [erroEntrada, setErroEntrada] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [recado, setRecado] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setCarregado(false);
    getRebalance({}, controller.signal)
      .then((resultado) => {
        setDados(resultado);
        setRfTexto(textoDeE6(resultado.targets.rfE6));
        setRvTexto(textoDeE6(resultado.targets.rvE6));
        setAporteTexto(textoDeCents(resultado.amountCents));
        setErro(null);
        setCarregado(true);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setErro(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [reloadToken]);

  useEffect(() => {
    if (!carregado) return;
    const rfE6 = parsePercentualParaE6(rfTexto, true);
    const rvE6 = parsePercentualParaE6(rvTexto, true);
    const aporte = aporteTexto.trim() === "" ? 0 : parseMoedaParaCents(aporteTexto);
    if (rfE6 === null || rvE6 === null) return setErroEntrada("meta inválida (ex.: 80 ou 72,5)");
    if (rfE6 + rvE6 !== SOMA_METAS) return setErroEntrada("as metas precisam somar 100%");
    if (aporte === null) return setErroEntrada("valor a investir inválido");
    setErroEntrada(null);
    setRecado(null);
    const controller = new AbortController();
    const id = setTimeout(() => {
      getRebalance({ amountCents: aporte, rfE6, rvE6 }, controller.signal)
        .then((resultado) => { setDados(resultado); setErro(null); })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setErro(cause instanceof Error ? cause.message : String(cause));
        });
    }, 400);
    return () => { clearTimeout(id); controller.abort(); };
  }, [carregado, rfTexto, rvTexto, aporteTexto]);

  async function salvar() {
    const rfE6 = parsePercentualParaE6(rfTexto, true);
    const rvE6 = parsePercentualParaE6(rvTexto, true);
    const aporte = aporteTexto.trim() === "" ? 0 : parseMoedaParaCents(aporteTexto);
    if (rfE6 === null || rvE6 === null) return setErroEntrada("meta inválida (ex.: 80 ou 72,5)");
    if (rfE6 + rvE6 !== SOMA_METAS) return setErroEntrada("as metas precisam somar 100%");
    if (aporte === null) return setErroEntrada("valor a investir inválido");
    setSalvando(true);
    setRecado(null);
    try {
      await saveRebalance({ rfE6, rvE6, amountCents: aporte });
      setRecado("Metas salvas");
    } catch (cause) {
      setErroEntrada(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Rebalanceamento</h1>
          <p className="page-sub">Fora da reserva de emergência · sem vender posições</p>
        </div>
      </div>

      {erro !== null && (
        <div className="callout callout-error" role="alert">
          <WarningCircle size={17} aria-hidden="true" />
          <div><p className="callout-title">Não foi possível calcular</p><p>{erro}</p></div>
        </div>
      )}

      <section className="card">
        <div className="reb-metas">
          <label className="campo">
            <span className="stat-label">Meta · Renda Fixa</span>
            <span className="campo-sufixo">
              <input inputMode="decimal" value={rfTexto} onChange={(evento) => setRfTexto(evento.target.value)} placeholder="80" />
              <span className="campo-sufixo-texto">%</span>
            </span>
          </label>
          <label className="campo">
            <span className="stat-label">Meta · Renda Variável</span>
            <span className="campo-sufixo">
              <input inputMode="decimal" value={rvTexto} onChange={(evento) => setRvTexto(evento.target.value)} placeholder="20" />
              <span className="campo-sufixo-texto">%</span>
            </span>
          </label>
          <label className="campo campo-largo">
            <span className="stat-label">Quanto quero investir</span>
            <span className="campo-moeda">
              <span className="campo-prefixo">R$</span>
              <input inputMode="decimal" value={aporteTexto} onChange={(evento) => setAporteTexto(evento.target.value)} placeholder="6.500,00" />
            </span>
          </label>
        </div>
        {erroEntrada !== null && <p className="campo-erro" role="alert">{erroEntrada}</p>}
        <div className="form-acoes">
          {recado !== null && <span className="reb-nota" role="status">{recado}</span>}
          <button type="button" className="btn btn-primary" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? "Salvando…" : "Salvar metas"}
          </button>
        </div>
      </section>

      {dados !== null && (
        <div className="reb-grade">
          {dados.groups.map((grupo) => (
            <section className="card reb-card" key={grupo.key}>
              <div className="reb-card-topo">
                <h2 className="reb-titulo">{ROTULOS[grupo.key] ?? grupo.key}</h2>
                {grupo.aboveTarget && <span className="badge badge-warn">acima da meta — sem aporte novo</span>}
              </div>
              <div className="reb-pct">
                <span className="reb-pct-bloco"><span className="stat-label">Hoje</span><strong>{formataPercentual(grupo.pctBefore)}</strong></span>
                <span className="reb-seta" aria-hidden="true">→</span>
                <span className="reb-pct-bloco"><span className="stat-label">Alvo</span><strong>{formataPercentual(grupo.targetE6 / 10_000)}</strong></span>
                <span className="reb-seta" aria-hidden="true">→</span>
                <span className="reb-pct-bloco"><span className="stat-label">Depois</span><strong>{formataPercentual(grupo.pctAfter)}</strong></span>
              </div>
              <div className="reb-valores">
                <span className="stat-label">Investir</span>
                <strong className="reb-sugerido">{formataBRL(grupo.suggestedCents)}</strong>
                <span className="reb-nota">
                  hoje {formataBRL(grupo.valueCents)} · depois {formataBRL(grupo.afterValueCents)}
                </span>
              </div>
            </section>
          ))}
        </div>
      )}

      {dados !== null && (
        <p className="reb-nota">
          Carteira fora da reserva: {formataBRL(dados.baseCents)} + aporte {formataBRL(dados.amountCents)} ={" "}
          {formataBRL(dados.baseCents + dados.amountCents)}.
          {dados.stale && " Há cotações desatualizadas — usando o último valor conhecido."}
        </p>
      )}
    </div>
  );
}
