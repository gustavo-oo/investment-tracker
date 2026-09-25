import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

export function Gaveta({ aberta, titulo, onFechar, children }: {
  aberta: boolean; titulo: string; onFechar: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (aberta && !dialog.open) dialog.showModal();
    if (!aberta && dialog.open) dialog.close();
  }, [aberta]);

  return (
    <dialog
      ref={ref}
      className="gaveta"
      aria-label={titulo}
      onClose={onFechar}
      onClick={(evento) => { if (evento.target === ref.current) onFechar(); }}
    >
      <div className="gaveta-caixa">
        <button type="button" className="gaveta-fechar" onClick={onFechar}>
          <X size={16} aria-hidden="true" /> Fechar
        </button>
        {children}
      </div>
    </dialog>
  );
}
