export function Segmented<T extends string>({ valor, opcoes, onMudar, desabilitado = false, rotulo }: {
  valor: T;
  opcoes: Array<{ valor: T; rotulo: string }>;
  onMudar: (valor: T) => void;
  desabilitado?: boolean;
  rotulo: string;
}) {
  return (
    <span className="segmented" role="group" aria-label={rotulo}>
      {opcoes.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          className={opcao.valor === valor ? "segmented-item ativo" : "segmented-item"}
          aria-pressed={opcao.valor === valor}
          disabled={desabilitado}
          onClick={() => onMudar(opcao.valor)}
        >
          {opcao.rotulo}
        </button>
      ))}
    </span>
  );
}
