import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";

export function Modal({ aberto, titulo, onFechar, children }: {
  aberto: boolean; titulo: string; onFechar: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (aberto && !dialog.open) dialog.showModal();
    if (!aberto && dialog.open) dialog.close();
  }, [aberto]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={titulo}
      onClose={onFechar}
      onClick={(evento) => { if (evento.target === ref.current) onFechar(); }}
    >
      <div className="modal-caixa">
        <div className="section-head section-head-linha">
          <h2 className="section-title">{titulo}</h2>
          <button type="button" className="btn btn-secondary" onClick={onFechar}>
            <X size={15} aria-hidden="true" /> Fechar
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
