import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type Props = {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

// Pilha de painéis abertos: o Esc fecha só o de cima.
const open: number[] = [];
let seq = 0;

/** Painel que sobe de baixo no celular e vira janela central no computador. */
export function Sheet({ title, onClose, children, footer, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = ++seq;
    open.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open[open.length - 1] === id) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // No celular não abre o teclado sozinho; no computador já foca o primeiro campo.
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const first = touch
      ? null
      : ref.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea, button:not(.sheet-close)');
    (first ?? ref.current)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = open.indexOf(id);
      if (i >= 0) open.splice(i, 1);
      document.body.style.overflow = prev;
    };
  }, []);

  return createPortal(
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn sheet-close" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
