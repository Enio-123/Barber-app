import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Sheet } from '../ui/Sheet';

type Toast = { id: number; kind: 'success' | 'error'; text: string };
type ConfirmOpts = { title: string; text?: string; confirm?: string; cancel?: string; danger?: boolean };

type Feedback = {
  toast: (text: string, kind?: Toast['kind']) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
};

const Ctx = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [ask, setAsk] = useState<ConfirmOpts | null>(null);
  const resolver = useRef<(v: boolean) => void>();
  const seq = useRef(0);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5200 : 3200);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => {
    setAsk(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (v: boolean) => {
    resolver.current?.(v);
    setAsk(null);
  };

  return (
    <Ctx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CircleCheck size={18} /> : <CircleAlert size={18} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      {ask && (
        <Sheet
          title={ask.title}
          onClose={() => answer(false)}
          footer={
            <>
              <button className="btn outline" onClick={() => answer(false)}>
                {ask.cancel ?? 'Voltar'}
              </button>
              <button className={`btn ${ask.danger ? 'danger' : 'primary'}`} onClick={() => answer(true)} autoFocus>
                {ask.confirm ?? 'Confirmar'}
              </button>
            </>
          }
        >
          {ask.text && <p className="text-2">{ask.text}</p>}
        </Sheet>
      )}
    </Ctx.Provider>
  );
}

export function useFeedback() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback fora do FeedbackProvider');
  return v;
}
