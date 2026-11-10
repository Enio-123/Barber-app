import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ban, CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { tzOf, useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { addDays, formatDay, minToHhmm, timeOf, todayKey, weekdayOf, zonedToDate, WEEKDAYS_SHORT, type DayKey } from '../lib/time';
import { money } from '../lib/format';
import type { Appointment } from '../lib/types';
import { Avatar, Loading, Notice, Segmented } from '../ui/kit';
import { AdminTitle } from './AdminLayout';
import { SetupSteps } from './SetupSteps';
import { AgendaGrid, AgendaList } from './AgendaViews';
import { AppointmentSheet } from './AppointmentSheet';
import { BookingSheet } from './BookingSheet';
import { BlockSheet } from './BlockSheet';
import { fetchDay, fetchWeekCounts } from './data';

type View = 'grade' | 'lista';
const VIEW_KEY = 'easycut-admin-view';

function initialView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved === 'grade' || saved === 'lista') return saved;
  } catch {
    /* sem armazenamento: usa o padrão da tela */
  }
  return window.matchMedia('(max-width: 760px)').matches ? 'lista' : 'grade';
}

/** No celular a grade fica apertada: lá a agenda aparece sempre em lista. */
function useNarrow() {
  const query = '(max-width: 560px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function AgendaPage() {
  const { shop, barbers, hours, loading } = useShop();
  const { toast } = useFeedback();
  const tz = tzOf(shop);
  const today = todayKey(tz);
  const [params, setParams] = useSearchParams();
  const param = params.get('dia');
  const day: DayKey = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today;
  const setDay = (d: DayKey) => setParams(d === today ? {} : { dia: d }, { replace: true });

  const narrow = useNarrow();
  const [view, setViewState] = useState<View>(initialView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignora */
    }
  };
  const [filter, setFilter] = useState('all');
  const [appts, setAppts] = useState<Appointment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [week, setWeek] = useState<Record<DayKey, number>>({});
  const [open, setOpen] = useState<Appointment | null>(null);
  const [creating, setCreating] = useState<null | { barberId?: string; start?: string }>(null);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [blocking, setBlocking] = useState(false);
  const known = useRef<{ day: DayKey; ids: Set<string> } | null>(null);
  const monday = addDays(day, -((weekdayOf(day) + 6) % 7));

  const load = useCallback(async () => {
    const [{ data, error }, counts] = await Promise.all([fetchDay(day, tz), fetchWeekCounts(monday, tz)]);
    if (error) {
      setFailed(true);
      return data;
    }
    setFailed(false);
    // Avisa quando chega agendamento novo pelo app com o painel aberto.
    const prev = known.current;
    if (prev && prev.day === day) {
      for (const a of data) {
        if (a.kind === 'booking' && a.source === 'app' && a.status === 'confirmed' && !prev.ids.has(a.id)) {
          toast(`Novo agendamento: ${a.client_name ?? 'cliente'} às ${timeOf(a.starts_at, tz)}`);
        }
      }
    }
    known.current = { day, ids: new Set(data.map((a) => a.id)) };
    setAppts(data);
    setWeek(counts);
    return data;
  }, [day, tz, monday, toast]);

  useEffect(() => {
    setAppts(null);
    void load();
  }, [load]);

  // Atualiza sozinho a cada 30 s e quando o dono volta para a aba.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const t = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  if (loading) return <Loading />;

  const cols = barbers.filter((b) => (b.active || (appts ?? []).some((a) => a.barber_id === b.id)) && (filter === 'all' || b.id === filter));
  const list = (appts ?? []).filter((a) => filter === 'all' || a.barber_id === filter);
  const bookings = list.filter((a) => a.kind === 'booking');
  const active = bookings.filter((a) => a.status !== 'cancelled');
  const revenue = active.filter((a) => a.status !== 'no_show').reduce((s, a) => s + (a.total_cents ?? 0), 0);
  const hoursToday = hours.find((h) => h.weekday === weekdayOf(day));
  const slot = shop?.slot_minutes ?? 30;
  const chipBarbers = barbers.filter((b) => b.active || (appts ?? []).some((a) => a.barber_id === b.id));

  const afterChange = async (message: string, reopenId?: string) => {
    toast(message);
    setOpen(null);
    const data = await load();
    if (reopenId) {
      const again = data.find((a) => a.id === reopenId);
      if (again) setOpen(again);
    }
  };

  // Depois de marcar ou remarcar: vai para o dia do horário e abre os detalhes.
  const afterSave = (id: string, message: string, savedDay: DayKey) => {
    if (savedDay === day) return void afterChange(message, id);
    toast(message);
    setDay(savedDay);
  };

  const dayLabel = day === today ? `Hoje, ${formatDay(day).toLowerCase()}` : day === addDays(today, 1) ? `Amanhã, ${formatDay(day).toLowerCase()}` : formatDay(day);

  return (
    <div className="stack lg agenda-page">
      <AdminTitle title="Agenda" sub={dayLabel}>
        <button className="btn outline" onClick={() => setBlocking(true)} disabled={!barbers.some((b) => b.active)}>
          <Ban size={17} /> Bloquear horário
        </button>
        <button className="btn primary" onClick={() => setCreating({})} disabled={!barbers.some((b) => b.active)}>
          <CalendarPlus size={17} /> Novo agendamento
        </button>
      </AdminTitle>

      <SetupSteps />

      <div className="card card-pad stack">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div className="date-nav">
            <button className="icon-btn" aria-label="Dia anterior" onClick={() => setDay(addDays(day, -1))}>
              <ChevronLeft size={20} />
            </button>
            <button className="btn sm outline" onClick={() => setDay(today)} disabled={day === today}>
              Hoje
            </button>
            <button className="icon-btn" aria-label="Próximo dia" onClick={() => setDay(addDays(day, 1))}>
              <ChevronRight size={20} />
            </button>
            <input
              type="date"
              className="input date-input"
              value={day}
              aria-label="Escolher data"
              onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && setDay(e.target.value)}
            />
          </div>
          <div className="view-toggle" style={{ width: 190 }}>
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { value: 'grade', label: 'Grade' },
                { value: 'lista', label: 'Lista' },
              ]}
            />
          </div>
        </div>
        <div className="week-strip" role="group" aria-label="Dias da semana">
          {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => {
            const n = week[d] ?? 0;
            const closedDay = !hours.find((h) => h.weekday === weekdayOf(d))?.is_open;
            return (
              <button
                key={d}
                className={`week-day${d === today ? ' today' : ''}${closedDay ? ' closed' : ''}`}
                aria-pressed={d === day}
                aria-label={`${formatDay(d)}: ${n} ${n === 1 ? 'cliente' : 'clientes'}`}
                onClick={() => setDay(d)}
              >
                <span className="wd">{WEEKDAYS_SHORT[weekdayOf(d)]}</span>
                <span className="num">{Number(d.slice(8))}</span>
                <span className="cnt">{n > 0 ? n : closedDay ? '·' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="stat-row">
        <div className="card stat">
          <div className="k">Clientes marcados</div>
          <div className="v">{appts ? active.length : '–'}</div>
        </div>
        <div className="card stat">
          <div className="k">Concluídos</div>
          <div className="v">{appts ? bookings.filter((a) => a.status === 'completed').length : '–'}</div>
        </div>
        <div className="card stat">
          <div className="k">Previsto no dia</div>
          <div className="v">{appts ? money(revenue) : '–'}</div>
        </div>
        <div className="card stat">
          <div className="k">Cancelados</div>
          <div className="v">{appts ? bookings.filter((a) => a.status === 'cancelled').length : '–'}</div>
        </div>
      </div>

      {chipBarbers.length > 1 && (
        <div className="chips scroll-x" role="group" aria-label="Filtrar por barbeiro">
          <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            Todos
          </button>
          {chipBarbers.map((b) => (
            <button key={b.id} className="chip chip-avatar" aria-pressed={filter === b.id} onClick={() => setFilter(b.id)}>
              <Avatar name={b.name} photo={b.photo} size={22} />
              {b.name}
            </button>
          ))}
        </div>
      )}

      {failed && <Notice tone="danger">Sem conexão com o servidor. A agenda tenta de novo sozinha.</Notice>}
      {!hoursToday?.is_open && <Notice>Pelo horário cadastrado, a barbearia fica fechada neste dia.</Notice>}

      {appts === null ? (
        <div className="skeleton" style={{ height: 360 }} />
      ) : view === 'grade' && !narrow && cols.length > 0 ? (
        <AgendaGrid
          day={day}
          tz={tz}
          cols={cols}
          appts={list}
          hours={hoursToday}
          slot={slot}
          onOpen={setOpen}
          onFree={(barberId, minute) => setCreating({ barberId, start: zonedToDate(day, minToHhmm(minute), tz).toISOString() })}
        />
      ) : (
        <AgendaList
          day={day}
          tz={tz}
          appts={list}
          barbers={barbers}
          onOpen={setOpen}
          empty={
            barbers.some((b) => b.active) ? (
              <button className="btn outline" onClick={() => setCreating({})}>
                <CalendarPlus size={17} /> Marcar um cliente
              </button>
            ) : (
              <p>Cadastre os barbeiros para começar.</p>
            )
          }
        />
      )}

      {open && (
        <AppointmentSheet
          appt={open}
          tz={tz}
          onClose={() => setOpen(null)}
          onChanged={(m) => void afterChange(m)}
          onReschedule={() => {
            setRescheduling(open);
            setOpen(null);
          }}
        />
      )}
      {creating && (
        <BookingSheet
          tz={tz}
          initial={{ barberId: creating.barberId, start: creating.start, day }}
          onClose={() => setCreating(null)}
          onSaved={(id, m, d) => {
            setCreating(null);
            afterSave(id, m, d);
          }}
        />
      )}
      {rescheduling && (
        <BookingSheet
          tz={tz}
          reschedule={rescheduling}
          onClose={() => setRescheduling(null)}
          onSaved={(id, m, d) => {
            setRescheduling(null);
            afterSave(id, m, d);
          }}
        />
      )}
      {blocking && (
        <BlockSheet
          tz={tz}
          initial={{ day, barberId: filter !== 'all' ? filter : undefined }}
          onClose={() => setBlocking(false)}
          onSaved={(m) => {
            setBlocking(false);
            void afterChange(m);
          }}
        />
      )}
    </div>
  );
}
