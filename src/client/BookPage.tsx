import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarClock, Check, ChevronRight, Scissors, UserRound, Users, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { openStatus, tzOf, useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage, isCode } from '../lib/errors';
import { addDays, durationLabel, formatDay, minutesOf, timeOf, todayKey, weekdayOf, relativeLimit, type DayKey } from '../lib/time';
import { money, priceSummary, waLink } from '../lib/format';
import { Sheet } from '../ui/Sheet';
import { Calendar } from '../ui/Calendar';
import { Avatar, Empty, Loading, Notice, Segmented, Spinner, Stars } from '../ui/kit';
import { ProfileForm } from './ProfileForm';
import { TERMS_VERSION } from '../lib/legal';

type Draft = { barber: string | null; services: string[]; day: DayKey | null; start: string | null; note: string };
const KEY = 'easycut-draft';
const emptyDraft: Draft = { barber: null, services: [], day: null, start: null, note: '' };

function readDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? { ...emptyDraft, ...JSON.parse(raw) } : emptyDraft;
  } catch {
    return emptyDraft;
  }
}

type SheetName = 'barber' | 'services' | 'time' | 'profile' | 'terms' | null;

export function BookPage() {
  const { session, profile, refreshProfile } = useAuth();
  const { shop, services, barbers, hours, ratings, loading, error } = useShop();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(readDraft);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [saving, setSaving] = useState(false);

  const tz = tzOf(shop);
  const activeServices = useMemo(() => services.filter((s) => s.active), [services]);
  const activeBarbers = useMemo(() => barbers.filter((b) => b.active), [barbers]);
  const ready = activeServices.length > 0 && activeBarbers.length > 0 && hours.some((h) => h.is_open);

  // Descarta escolhas que não valem mais (serviço desativado, horário que já passou).
  useEffect(() => {
    if (loading) return;
    setDraft((d) => {
      const servicesOk = d.services.filter((id) => activeServices.some((s) => s.id === id));
      const barberOk = d.barber === 'any' || activeBarbers.some((b) => b.id === d.barber) ? d.barber : null;
      const startOk = d.start && new Date(d.start).getTime() > Date.now() ? d.start : null;
      const changed = servicesOk.length !== d.services.length || barberOk !== d.barber || startOk !== d.start;
      return changed ? { ...d, services: servicesOk, barber: barberOk, start: startOk, day: startOk ? d.day : null } : d;
    });
  }, [loading, activeServices, activeBarbers]);

  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  }, [draft]);

  const chosen = activeServices.filter((s) => draft.services.includes(s.id));
  const duration = chosen.reduce((a, s) => a + s.duration_minutes, 0);
  const barber = activeBarbers.find((b) => b.id === draft.barber);
  const complete = draft.barber && chosen.length > 0 && draft.start;

  const status = openStatus(hours, tz);

  async function confirm(termsJustAccepted = false) {
    if (!complete || !draft.start) return;
    if (!session) {
      toast('Entre ou crie sua conta para confirmar o horário.');
      navigate('/entrar?voltar=/');
      return;
    }
    if (!profile?.full_name?.trim() || !profile.phone) {
      setSheet('profile');
      return;
    }
    // Conta antiga ou termos novos: pede o aceite antes de agendar.
    if (!termsJustAccepted && profile.terms_version !== TERMS_VERSION) {
      setSheet('terms');
      return;
    }
    setSaving(true);
    const { data, error: e } = await supabase.rpc('book_appointment', {
      p_service_ids: draft.services,
      p_starts_at: draft.start,
      p_barber_id: draft.barber === 'any' ? null : draft.barber,
      p_note: draft.note.trim() || null,
    });
    setSaving(false);
    if (e) {
      if (isCode(e, 'ACEITE_TERMOS')) return setSheet('terms');
      toast(errorMessage(e), 'error');
      if (isCode(e, 'HORARIO_INDISPONIVEL')) {
        setDraft((d) => ({ ...d, start: null }));
        setSheet('time');
      }
      if (isCode(e, 'PERFIL_INCOMPLETO')) setSheet('profile');
      return;
    }
    sessionStorage.removeItem(KEY);
    setDraft(emptyDraft);
    navigate(`/agendado/${data as string}`);
  }

  if (loading) return <Loading />;
  if (error && !shop) {
    return (
      <Empty title="Não foi possível carregar a agenda">
        <p>Verifique sua internet e tente de novo.</p>
      </Empty>
    );
  }

  if (!ready) {
    return (
      <div className="stack lg">
        <div className="camo-hero">
          <h1 className="page-title">Agende seu horário</h1>
        </div>
        <Empty icon={<CalendarClock size={36} />} title="Agenda online em preparação">
          <p>A barbearia ainda está cadastrando serviços, barbeiros e horários.</p>
          {shop?.whatsapp && (
            <a className="btn outline" href={waLink(shop.whatsapp, 'Olá! Gostaria de agendar um horário.')} target="_blank" rel="noreferrer">
              <MessageCircle size={18} /> Agendar pelo WhatsApp
            </a>
          )}
        </Empty>
      </div>
    );
  }

  const barberLabel = draft.barber === 'any' ? 'Sem preferência' : barber?.name;
  const timeLabel = draft.start && draft.day ? `${formatDay(draft.day, 'medium')} às ${timeOf(draft.start, tz)}` : null;

  return (
    <div className="stack lg">
      <div className="camo-hero">
        <h1 className="page-title">Agende seu horário</h1>
        <p className="page-sub">Escolha o barbeiro, os serviços e o horário que preferir.</p>
        {status && (
          <p className="status-line">
            <span className={`dot ${status.open ? 'open' : 'closed'}`} />
            {status.text}
          </p>
        )}
      </div>

      <div className="stack">
        <button className={`picker${draft.barber ? ' done' : ''}`} onClick={() => setSheet('barber')}>
          <span className="picker-icon">{draft.barber ? <Check size={20} /> : <UserRound size={20} />}</span>
          <span className="grow">
            <span className="picker-label">Barbeiro</span>
            <span className={`picker-value${barberLabel ? '' : ' placeholder'}`} style={{ display: 'block' }}>
              {barberLabel ?? 'Selecionar barbeiro'}
            </span>
          </span>
          <ChevronRight size={20} className="muted" />
        </button>

        <button className={`picker${chosen.length ? ' done' : ''}`} onClick={() => setSheet('services')} disabled={!draft.barber}>
          <span className="picker-icon">{chosen.length ? <Check size={20} /> : <Scissors size={20} />}</span>
          <span className="grow">
            <span className="picker-label">Serviços</span>
            <span className={`picker-value ellipsis${chosen.length ? '' : ' placeholder'}`} style={{ display: 'block' }}>
              {chosen.length ? chosen.map((s) => s.name).join(', ') : 'Selecionar serviço'}
            </span>
          </span>
          <ChevronRight size={20} className="muted" />
        </button>

        <button className={`picker${draft.start ? ' done' : ''}`} onClick={() => setSheet('time')} disabled={!draft.barber || !chosen.length}>
          <span className="picker-icon">{draft.start ? <Check size={20} /> : <CalendarClock size={20} />}</span>
          <span className="grow">
            <span className="picker-label">Data e hora</span>
            <span className={`picker-value${timeLabel ? '' : ' placeholder'}`} style={{ display: 'block' }}>
              {timeLabel ?? 'Selecionar data e hora'}
            </span>
          </span>
          <ChevronRight size={20} className="muted" />
        </button>
      </div>

      {chosen.length > 0 && (
        <div className="card card-pad">
          <p className="section-title" style={{ marginBottom: 8 }}>
            Resumo
          </p>
          {chosen.map((s) => (
            <div key={s.id} className="summary-line">
              <span>
                {s.name} <span className="muted">· {durationLabel(s.duration_minutes)}</span>
              </span>
              <span>{money(s.price_cents)}</span>
            </div>
          ))}
          <hr className="divider" style={{ margin: '6px 0' }} />
          <div className="summary-line total">
            <span>Total · {durationLabel(duration)}</span>
            <span>{priceSummary(chosen)}</span>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="note">Observação (opcional)</label>
            <textarea
              id="note"
              className="textarea"
              maxLength={300}
              placeholder="Ex.: quero degradê na lateral"
              value={draft.note}
              onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            />
          </div>
        </div>
      )}

      <button className="btn primary block" disabled={!complete || saving} onClick={() => void confirm()}>
        {saving ? <Spinner small /> : null}
        {session ? 'Confirmar agendamento' : 'Entrar e confirmar'}
      </button>
      {shop && shop.min_advance_minutes > 0 && (
        <p className="hint" style={{ textAlign: 'center', marginTop: -8 }}>
          Agendamentos com pelo menos {relativeLimit(shop.min_advance_minutes)} de antecedência.
        </p>
      )}

      {sheet === 'barber' && (
        <Sheet title="Escolha o barbeiro" onClose={() => setSheet(null)}>
          <button
            className="option"
            aria-pressed={draft.barber === 'any'}
            onClick={() => {
              setDraft((d) => ({ ...d, barber: 'any', start: null }));
              setSheet(chosen.length ? 'time' : 'services');
            }}
          >
            <span className="avatar" style={{ width: 48, height: 48 }}>
              <Users size={22} />
            </span>
            <span className="grow">
              <span className="option-title" style={{ display: 'block' }}>
                Sem preferência
              </span>
              <span className="option-sub">O primeiro barbeiro livre no horário</span>
            </span>
          </button>
          {activeBarbers.map((b) => {
            const r = ratings[b.id];
            return (
              <button
                key={b.id}
                className="option"
                aria-pressed={draft.barber === b.id}
                onClick={() => {
                  setDraft((d) => ({ ...d, barber: b.id, start: null }));
                  setSheet(chosen.length ? 'time' : 'services');
                }}
              >
                <Avatar name={b.name} photo={b.photo} size={48} />
                <span className="grow">
                  <span className="option-title" style={{ display: 'block' }}>
                    {b.name}
                  </span>
                  {b.bio && <span className="option-sub" style={{ display: 'block' }}>{b.bio}</span>}
                  {r && (
                    <span className="row small muted" style={{ gap: 6, marginTop: 2 }}>
                      <Stars value={r.average} size={13} /> {r.average.toFixed(1).replace('.', ',')} ({r.total})
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </Sheet>
      )}

      {sheet === 'services' && (
        <ServicesSheet
          services={activeServices}
          selected={draft.services}
          onClose={() => setSheet(null)}
          onDone={(ids) => {
            setDraft((d) => ({ ...d, services: ids, start: null }));
            setSheet(ids.length ? 'time' : null);
          }}
        />
      )}

      {sheet === 'time' && shop && (
        <TimeSheet
          tz={tz}
          maxDays={shop.max_days_ahead}
          minAdvance={shop.min_advance_minutes}
          isClosed={(d) => !hours.find((h) => h.weekday === weekdayOf(d))?.is_open}
          serviceIds={draft.services}
          barberId={draft.barber === 'any' ? null : draft.barber}
          initialDay={draft.day}
          initialStart={draft.start}
          onClose={() => setSheet(null)}
          onDone={(day, start) => {
            setDraft((d) => ({ ...d, day, start }));
            setSheet(null);
          }}
        />
      )}

      {sheet === 'terms' && (
        <TermsSheet
          onClose={() => setSheet(null)}
          onAccepted={async () => {
            setSheet(null);
            await refreshProfile();
            void confirm(true);
          }}
        />
      )}

      {sheet === 'profile' && (
        <Sheet title="Complete seu cadastro" onClose={() => setSheet(null)}>
          <p className="text-2" style={{ marginBottom: 16 }}>
            A barbearia usa seu nome e WhatsApp para confirmar o horário.
          </p>
          <ProfileForm
            submitLabel="Salvar e confirmar"
            onSaved={async () => {
              await refreshProfile();
              setSheet(null);
              toast('Cadastro completo. Agora é só confirmar.');
            }}
          />
        </Sheet>
      )}
    </div>
  );
}

function TermsSheet({ onClose, onAccepted }: { onClose: () => void; onAccepted: () => void | Promise<void> }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  async function accept() {
    setBusy(true);
    const { error } = await supabase.rpc('accept_terms', { p_version: TERMS_VERSION });
    setBusy(false);
    if (error) return toast(errorMessage(error), 'error');
    await onAccepted();
  }
  return (
    <Sheet
      title="Termos e privacidade"
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Agora não
          </button>
          <button className="btn primary" disabled={busy} onClick={accept}>
            {busy && <Spinner small />} Aceitar e agendar
          </button>
        </>
      }
    >
      <p className="text-2">
        Para agendar, leia e aceite os{' '}
        <Link to="/termos" target="_blank" rel="noopener">
          Termos de uso
        </Link>{' '}
        e a{' '}
        <Link to="/privacidade" target="_blank" rel="noopener">
          Política de privacidade
        </Link>
        . Eles explicam as regras de agendamento e cancelamento e como a barbearia usa seu nome, WhatsApp e e-mail.
      </p>
    </Sheet>
  );
}

function ServicesSheet({ services, selected, onClose, onDone }: {
  services: import('../lib/types').Service[];
  selected: string[];
  onClose: () => void;
  onDone: (ids: string[]) => void;
}) {
  const [ids, setIds] = useState<string[]>(selected);
  const chosen = services.filter((s) => ids.includes(s.id));
  const duration = chosen.reduce((a, s) => a + s.duration_minutes, 0);
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  return (
    <Sheet
      title="Escolha os serviços"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!ids.length} onClick={() => onDone(ids)}>
          {ids.length ? `Continuar · ${durationLabel(duration)} · ${priceSummary(chosen)}` : 'Escolha pelo menos um'}
        </button>
      }
    >
      {services.map((s) => {
        const on = ids.includes(s.id);
        return (
          <button key={s.id} className="option" role="checkbox" aria-checked={on} onClick={() => toggle(s.id)}>
            <span className={`check${on ? ' on' : ''}`}>{on && <Check size={15} strokeWidth={3} />}</span>
            <span className="grow">
              <span className="option-title" style={{ display: 'block' }}>
                {s.name}
              </span>
              <span className="option-sub">
                {durationLabel(s.duration_minutes)}
                {s.description ? ` · ${s.description}` : ''}
              </span>
            </span>
            <span className="option-side">{money(s.price_cents)}</span>
          </button>
        );
      })}
    </Sheet>
  );
}

type Period = 'manha' | 'tarde' | 'noite';

function TimeSheet(props: {
  tz: string;
  maxDays: number;
  minAdvance: number;
  isClosed: (d: DayKey) => boolean;
  serviceIds: string[];
  barberId: string | null;
  initialDay: DayKey | null;
  initialStart: string | null;
  onClose: () => void;
  onDone: (day: DayKey, start: string) => void;
}) {
  const { tz, maxDays, isClosed, serviceIds, barberId } = props;
  const today = todayKey(tz);
  const max = addDays(today, maxDays);
  const firstOpen = useMemo(() => {
    for (let i = 0; i <= maxDays; i++) {
      const d = addDays(today, i);
      if (!isClosed(d)) return d;
    }
    return null;
  }, [today, maxDays, isClosed]);

  const [day, setDay] = useState<DayKey | null>(props.initialDay ?? firstOpen);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<string | null>(props.initialStart);
  const [period, setPeriod] = useState<Period>('manha');

  const load = useCallback(async (d: DayKey) => {
    setSlots(null);
    setFailed(false);
    const { data, error } = await supabase.rpc('get_availability', {
      p_date: d,
      p_service_ids: serviceIds,
      p_barber_id: barberId,
    });
    if (error) {
      setFailed(true);
      setSlots([]);
      return;
    }
    const unique = Array.from(new Set((data as { starts_at: string }[]).map((r) => new Date(r.starts_at).toISOString()))).sort();
    setSlots(unique);
    const first = unique[0];
    if (first) {
      const m = minutesOf(first, tz);
      setPeriod(m < 720 ? 'manha' : m < 1080 ? 'tarde' : 'noite');
    }
  }, [serviceIds, barberId, tz]);

  useEffect(() => {
    if (day) void load(day);
  }, [day, load]);

  const groups = useMemo(() => {
    const g: Record<Period, string[]> = { manha: [], tarde: [], noite: [] };
    for (const s of slots ?? []) {
      const m = minutesOf(s, tz);
      g[m < 720 ? 'manha' : m < 1080 ? 'tarde' : 'noite'].push(s);
    }
    return g;
  }, [slots, tz]);

  const pickValid = pick && slots?.includes(new Date(pick).toISOString());

  return (
    <Sheet
      title="Data do agendamento"
      onClose={props.onClose}
      footer={
        <button className="btn primary" disabled={!day || !pickValid} onClick={() => day && pick && props.onDone(day, new Date(pick).toISOString())}>
          Selecionar
        </button>
      }
    >
      <Calendar
        value={day}
        today={today}
        max={max}
        isClosed={isClosed}
        onChange={(d) => {
          setDay(d);
          setPick(null);
        }}
      />
      <div className="stack" style={{ marginTop: 18 }}>
        <strong>Escolha o melhor horário</strong>
        {props.minAdvance > 0 && (
          <Notice>Os agendamentos devem ser feitos com pelo menos {relativeLimit(props.minAdvance)} de antecedência.</Notice>
        )}
        {!day ? (
          <p className="muted">Escolha um dia no calendário.</p>
        ) : slots === null ? (
          <div className="slots">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 42 }} />
            ))}
          </div>
        ) : failed ? (
          <Notice tone="danger">Não foi possível carregar os horários. Tente de novo.</Notice>
        ) : slots.length === 0 ? (
          <Empty title="Sem horários livres nesse dia">
            <p>Tente outro dia{barberId ? ' ou escolha "Sem preferência" de barbeiro' : ''}.</p>
          </Empty>
        ) : (
          <>
            <Segmented<Period>
              value={period}
              onChange={setPeriod}
              options={[
                { value: 'manha', label: 'Manhã', count: groups.manha.length, disabled: !groups.manha.length },
                { value: 'tarde', label: 'Tarde', count: groups.tarde.length, disabled: !groups.tarde.length },
                { value: 'noite', label: 'Noite', count: groups.noite.length, disabled: !groups.noite.length },
              ]}
            />
            <div className="slots">
              {groups[period].map((s) => (
                <button key={s} className="slot" aria-pressed={pick ? new Date(pick).toISOString() === s : false} onClick={() => setPick(s)}>
                  {timeOf(s, tz)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
