import { CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';
import { hhmmToMin, minToHhmm, timeOf, zonedToDate, type DayKey } from '../lib/time';
import type { Appointment, Barber, Hours } from '../lib/types';
import { Avatar, Empty, StatusBadge } from '../ui/kit';
import { minuteIn } from './data';

const PX = 1.6; // pixels por minuto na grade: 30 min = 48 px

type GridProps = {
  day: DayKey;
  tz: string;
  cols: Barber[];
  appts: Appointment[];
  hours: Hours | undefined;
  slot: number;
  onOpen: (a: Appointment) => void;
  onFree: (barberId: string, minute: number) => void;
};

const services = (a: Appointment) => (a.items ?? []).map((i) => i.name).join(', ');

function blockLabel(a: Appointment, dayStart: number, tz: string) {
  const s = minuteIn(a.starts_at, dayStart);
  const e = minuteIn(a.ends_at, dayStart);
  if (s <= 0 && e >= 1440) return 'Dia todo';
  return `${timeOf(a.starts_at, tz)} – ${timeOf(a.ends_at, tz)}`;
}

/** Agenda do dia em colunas, uma por barbeiro (computador e tablet). */
export function AgendaGrid({ day, tz, cols, appts, hours, slot, onOpen, onFree }: GridProps) {
  const dayStart = zonedToDate(day, '00:00', tz).getTime();
  const open = hours?.is_open ? hhmmToMin(hours.opens) : null;
  const close = hours?.is_open ? hhmmToMin(hours.closes) : null;
  const breakStart = hours?.is_open && hours.break_start ? hhmmToMin(hours.break_start) : null;
  const breakEnd = hours?.is_open && hours.break_end ? hhmmToMin(hours.break_end) : null;
  const visible = appts.filter((a) => a.status !== 'cancelled');

  // A grade vai do horário de abertura ao de fechamento, e cresce se tiver cliente marcado fora dele.
  let from = open ?? 8 * 60;
  let to = close ?? 20 * 60;
  for (const a of visible) {
    if (a.kind !== 'booking') continue;
    from = Math.min(from, Math.max(0, minuteIn(a.starts_at, dayStart)));
    to = Math.max(to, Math.min(1440, minuteIn(a.ends_at, dayStart)));
  }
  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;
  const height = (to - from) * PX;
  const y = (m: number) => (m - from) * PX;
  const marks: number[] = [];
  for (let m = from; m <= to; m += 60) marks.push(m);

  const closed: [number, number][] = [];
  if (open == null || close == null) closed.push([from, to]);
  else {
    if (open > from) closed.push([from, open]);
    if (close < to) closed.push([close, to]);
    if (breakStart != null && breakEnd != null) closed.push([breakStart, breakEnd]);
  }

  const nowMin = minuteIn(new Date().toISOString(), dayStart);
  const showNow = nowMin >= from && nowMin <= to;

  return (
    <div className="card agenda">
      <div className="agenda-grid" style={{ gridTemplateColumns: `58px repeat(${cols.length}, minmax(150px, 1fr))` }}>
        <div className="agenda-head corner" />
        {cols.map((b) => (
          <div key={b.id} className="agenda-head">
            <Avatar name={b.name} photo={b.photo} size={28} />
            <span className="ellipsis">{b.name}</span>
          </div>
        ))}
        <div className="agenda-times" style={{ height }}>
          {marks.map((m, i) => (
            <span key={m} className="agenda-time" style={{ top: y(m), transform: i === 0 ? 'translateY(2px)' : undefined }}>
              {minToHhmm(m % 1440)}
            </span>
          ))}
        </div>
        {cols.map((b) => {
          const mine = visible.filter((a) => a.barber_id === b.id);
          const busy = mine.map((a) => [minuteIn(a.starts_at, dayStart), minuteIn(a.ends_at, dayStart)] as const);
          const free: number[] = [];
          if (open != null && close != null && b.active) {
            for (let m = open; m + slot <= close; m += slot) {
              const inBreak = breakStart != null && breakEnd != null && m < breakEnd && m + slot > breakStart;
              const taken = busy.some(([s, e]) => m < e && m + slot > s);
              const future = dayStart + (m + slot) * 60000 > Date.now();
              if (!inBreak && !taken && future) free.push(m);
            }
          }
          return (
            <div key={b.id} className="agenda-col" style={{ height }}>
              {marks.map((m) => (
                <div key={m} className="agenda-line" style={{ top: y(m) }} />
              ))}
              {marks.slice(0, -1).map((m) => (
                <div key={`h${m}`} className="agenda-line half" style={{ top: y(m + 30) }} />
              ))}
              {closed.map(([s, e]) => (
                <div key={`c${s}`} className="agenda-closed" style={{ top: y(s), height: (e - s) * PX }} />
              ))}
              {free.map((m) => (
                <button
                  key={`f${m}`}
                  className="agenda-free"
                  style={{ top: y(m), height: slot * PX }}
                  onClick={() => onFree(b.id, m)}
                  aria-label={`Marcar às ${minToHhmm(m)} com ${b.name}`}
                >
                  <span>+ {minToHhmm(m)}</span>
                </button>
              ))}
              {mine.map((a) => {
                const s = Math.max(from, minuteIn(a.starts_at, dayStart));
                const e = Math.min(to, minuteIn(a.ends_at, dayStart));
                const isBlock = a.kind === 'block';
                return (
                  <button
                    key={a.id}
                    className={`event ${isBlock ? 'block' : a.status}`}
                    style={{ top: y(s) + 1, height: Math.max(20, (e - s) * PX - 2) }}
                    onClick={() => onOpen(a)}
                  >
                    <div className="ellipsis">
                      <span className="t">{isBlock ? blockLabel(a, dayStart, tz) : timeOf(a.starts_at, tz)}</span>{' '}
                      <span className="n">{isBlock ? a.note || 'Bloqueado' : a.client_name}</span>
                    </div>
                    {!isBlock && <div className="s ellipsis">{services(a)}</div>}
                  </button>
                );
              })}
              {showNow && <div className="agenda-now" style={{ top: y(nowMin) }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Agenda do dia em lista, em ordem de horário (melhor no celular). */
export function AgendaList({ day, tz, appts, barbers, onOpen, empty }: {
  day: DayKey;
  tz: string;
  appts: Appointment[];
  barbers: Barber[];
  onOpen: (a: Appointment) => void;
  empty: ReactNode;
}) {
  const dayStart = zonedToDate(day, '00:00', tz).getTime();
  if (!appts.length) {
    return (
      <div className="card">
        <Empty icon={<CalendarDays size={32} />} title="Nenhum horário neste dia">
          {empty}
        </Empty>
      </div>
    );
  }
  return (
    <div className="card">
      {appts.map((a) => {
        const b = barbers.find((x) => x.id === a.barber_id);
        const isBlock = a.kind === 'block';
        const allDay = isBlock && blockLabel(a, dayStart, tz) === 'Dia todo';
        return (
          <button key={a.id} className={`list-item agenda-item${a.status === 'cancelled' ? ' is-cancelled' : ''}${isBlock ? ' is-block' : ''}`} onClick={() => onOpen(a)}>
            <span className="agenda-item-time">
              {allDay ? (
                <strong>Dia todo</strong>
              ) : (
                <>
                  <strong>{timeOf(a.starts_at, tz)}</strong>
                  <span>{timeOf(a.ends_at, tz)}</span>
                </>
              )}
            </span>
            <span className="grow">
              <span className="row" style={{ gap: 8 }}>
                <strong className="ellipsis">{isBlock ? 'Horário bloqueado' : a.client_name}</strong>
                {!isBlock && a.status !== 'confirmed' && <StatusBadge status={a.status} />}
              </span>
              <span className="small muted ellipsis" style={{ display: 'block' }}>
                {isBlock ? a.note || 'Sem atendimento' : services(a)}
              </span>
            </span>
            <span className="row small muted" style={{ gap: 8 }}>
              <span className="hide-sm">{b?.name}</span>
              <Avatar name={b?.name ?? '?'} photo={b?.photo} size={28} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
