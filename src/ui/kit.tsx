import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff, Info, Star } from 'lucide-react';
import { initials } from '../lib/format';
import type { Status } from '../lib/types';

export function Wordmark({ size, center, tagline = 'Studio & Barber Shop', name = 'EasyCut' }: {
  size?: 'lg';
  center?: boolean;
  tagline?: string;
  name?: string;
}) {
  return (
    <span className={`wordmark${size ? ` ${size}` : ''}${center ? ' center' : ''}`} aria-label={`${name} ${tagline}`}>
      <span className="wordmark-name">{name}</span>
      {tagline && <span className="wordmark-tag">{tagline}</span>}
    </span>
  );
}

/** Nome da barbearia em letra cursiva: "Easy Cut" vira "EasyCut" como no logo. */
export const scriptName = (name: string) => name.replace(/\s+/g, '');

export function Spinner({ small }: { small?: boolean }) {
  return <span className={`spinner${small ? ' sm' : ''}`} role="progressbar" aria-label="Carregando" />;
}

export function Loading() {
  return (
    <div className="center-fill">
      <Spinner />
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Notice({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  return (
    <div className={`notice${tone ? ` ${tone}` : ''}`}>
      <Info size={17} />
      <div>{children}</div>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string | null };

export function Field({ label, hint, error, id, ...rest }: FieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      <input id={fid} className="input" aria-invalid={error ? true : undefined} {...rest} />
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function PasswordField({ label, error, hint, ...rest }: FieldProps) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input id={id} className="input" type={show ? 'text' : 'password'} aria-invalid={error ? true : undefined} {...rest} />
        <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Avatar({ name, photo, size = 40 }: { name: string; photo?: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {photo ? <img src={photo} alt="" /> : initials(name)}
    </span>
  );
}

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= Math.round(value) ? 'on' : ''} fill={i <= Math.round(value) ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

export function StarsInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="stars input" role="radiogroup" aria-label="Sua nota">
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} estrela${i > 1 ? 's' : ''}`} onClick={() => onChange(i)}>
          <Star className={i <= value ? 'on' : ''} fill={i <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </span>
  );
}

const STATUS: Record<Status, { label: string; tone: string }> = {
  confirmed: { label: 'Confirmado', tone: 'accent' },
  completed: { label: 'Concluído', tone: 'success' },
  cancelled: { label: 'Cancelado', tone: 'danger' },
  no_show: { label: 'Não compareceu', tone: 'warning' },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={`badge ${s.tone}`}>
      <span className="dot" />
      {s.label}
    </span>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; count?: number; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span className="count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
