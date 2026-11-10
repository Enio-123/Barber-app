import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabel, type DayKey } from '../lib/time';

type Props = {
  value: DayKey | null;
  onChange: (d: DayKey) => void;
  today: DayKey;
  max: DayKey;
  isClosed: (d: DayKey) => boolean;
};

const pad = (n: number) => String(n).padStart(2, '0');
const WD = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

export function Calendar({ value, onChange, today, max, isClosed }: Props) {
  const start = value ?? today;
  const [ym, setYm] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) }));

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(ym.y, ym.m - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7; // segunda primeiro
    const days = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
    const out: (DayKey | null)[] = Array.from({ length: offset }, () => null);
    for (let d = 1; d <= days; d++) out.push(`${ym.y}-${pad(ym.m)}-${pad(d)}`);
    return out;
  }, [ym]);

  const monthKey = `${ym.y}-${pad(ym.m)}`;
  const canPrev = monthKey > today.slice(0, 7);
  const canNext = monthKey < max.slice(0, 7);
  const move = (delta: number) =>
    setYm(({ y, m }) => {
      const t = new Date(Date.UTC(y, m - 1 + delta, 1));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
    });

  return (
    <div>
      <div className="cal-head">
        <button type="button" className="icon-btn" disabled={!canPrev} onClick={() => move(-1)} aria-label="Mês anterior">
          <ChevronLeft size={20} />
        </button>
        <strong>{monthLabel(ym.y, ym.m)}</strong>
        <button type="button" className="icon-btn" disabled={!canNext} onClick={() => move(1)} aria-label="Próximo mês">
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="cal-grid">
        {WD.map((w) => (
          <div key={w} className="cal-wd">
            {w}
          </div>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              className={`cal-day${d === today ? ' today' : ''}`}
              disabled={d < today || d > max || isClosed(d)}
              aria-pressed={d === value}
              aria-label={d}
              onClick={() => onChange(d)}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`x${i}`} className="cal-day out" />
          ),
        )}
      </div>
    </div>
  );
}
