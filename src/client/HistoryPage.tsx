import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, CalendarX2, Clock, MessageCircle, Scissors, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { tzOf, useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { dayKeyOf, formatDay, monthLabel, relativeLimit, timeOf, zoned } from '../lib/time';
import { money, waLink } from '../lib/format';
import { downloadIcs } from '../lib/ics';
import type { Appointment } from '../lib/types';
import { Avatar, Empty, Loading, StatusBadge, Stars, StarsInput, Spinner } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { LoginPrompt } from './LoginPrompt';

export const APPT_SELECT =
  'id, kind, barber_id, client_id, client_name, client_phone, starts_at, ends_at, status, total_cents, note, source, created_at, cancelled_at, cancelled_by, barber:barbers(id, name, photo), items:appointment_services(service_id, name, duration_minutes, price_cents), review:reviews(rating, comment)';

export const reviewOf = (a: Appointment) => (Array.isArray(a.review) ? a.review[0] ?? null : a.review ?? null);

export function HistoryPage() {
  const { session } = useAuth();
  const { shop } = useShop();
  const { toast, confirm } = useFeedback();
  const tz = tzOf(shop);
  const [list, setList] = useState<Appointment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [rating, setRating] = useState<Appointment | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('appointments')
      .select(APPT_SELECT)
      .eq('kind', 'booking')
      .order('starts_at', { ascending: false })
      .limit(200);
    setFailed(Boolean(error));
    setList((data as unknown as Appointment[]) ?? []);
  }, []);

  useEffect(() => {
    if (!session) return;
    void load();
    // Atualiza quando o cliente volta para o app (a barbearia pode ter remarcado ou concluído).
    const refresh = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [session, load]);

  const now = Date.now();
  const upcoming = useMemo(
    () => (list ?? []).filter((a) => a.status === 'confirmed' && new Date(a.ends_at).getTime() > now).reverse(),
    [list, now],
  );
  const past = useMemo(() => (list ?? []).filter((a) => !upcoming.includes(a)), [list, upcoming]);
  const months = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of past) {
      const z = zoned(a.starts_at, tz);
      const k = monthLabel(z.year, z.month);
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [past, tz]);

  if (!session) return <LoginPrompt title="Seus horários aparecem aqui" text="Entre na sua conta para ver, cancelar e avaliar seus atendimentos." />;
  if (list === null) return <Loading />;

  async function cancel(a: Appointment) {
    const ok = await confirm({
      title: 'Cancelar agendamento?',
      text: `${formatDay(dayKeyOf(a.starts_at, tz))} às ${timeOf(a.starts_at, tz)} com ${a.barber?.name ?? 'o barbeiro'}. O horário fica livre para outra pessoa.`,
      confirm: 'Cancelar horário',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.rpc('cancel_appointment', { p_id: a.id });
    if (error) return toast(errorMessage(error), 'error');
    toast('Agendamento cancelado.');
    void load();
  }

  const limit = shop?.cancel_limit_minutes ?? 120;

  return (
    <div className="stack lg">
      <h1 className="page-title">Meus horários</h1>
      {failed && <p className="error-text">Não foi possível atualizar a lista. Tente de novo.</p>}

      <section className="stack">
        <p className="section-title">Agendamento em aberto</p>
        {upcoming.length === 0 ? (
          <div className="card">
            <Empty icon={<CalendarPlus size={32} />} title="Nenhum horário marcado">
              <Link className="btn primary" to="/">
                Agendar agora
              </Link>
            </Empty>
          </div>
        ) : (
          upcoming.map((a) => {
            const canCancel = new Date(a.starts_at).getTime() - Date.now() >= limit * 60000;
            const items = a.items ?? [];
            return (
              <article key={a.id} className="card appt-card stack">
                <div className="row between">
                  <strong>{formatDay(dayKeyOf(a.starts_at, tz))}</strong>
                  <StatusBadge status={a.status} />
                </div>
                <div className="appt-meta">
                  <span>
                    <Clock size={15} /> {timeOf(a.starts_at, tz)} – {timeOf(a.ends_at, tz)}
                  </span>
                  <span>
                    <UserRound size={15} /> {a.barber?.name}
                  </span>
                  <span>
                    <Scissors size={15} /> {items.map((i) => i.name).join(', ')}
                  </span>
                </div>
                {a.total_cents != null && a.total_cents > 0 && <p className="small text-2">Total: {money(a.total_cents)}</p>}
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <button
                    className="btn sm outline"
                    onClick={() =>
                      downloadIcs({
                        id: a.id,
                        title: `${shop?.name ?? 'Barbearia'} · ${items.map((i) => i.name).join(', ')}`,
                        start: a.starts_at,
                        end: a.ends_at,
                        description: `Com ${a.barber?.name ?? ''}`,
                        location: shop?.address,
                      })
                    }
                  >
                    <CalendarPlus size={16} /> Salvar na agenda
                  </button>
                  {canCancel ? (
                    <button className="btn sm danger" onClick={() => cancel(a)}>
                      <CalendarX2 size={16} /> Cancelar
                    </button>
                  ) : (
                    shop?.whatsapp && (
                      <a
                        className="btn sm outline"
                        target="_blank"
                        rel="noreferrer"
                        href={waLink(shop.whatsapp, `Olá! Preciso falar sobre meu horário de ${formatDay(dayKeyOf(a.starts_at, tz), 'medium')} às ${timeOf(a.starts_at, tz)}.`)}
                      >
                        <MessageCircle size={16} /> Falar no WhatsApp
                      </a>
                    )
                  )}
                </div>
                {!canCancel && limit > 0 && (
                  <p className="hint">Pelo app, dá para cancelar até {relativeLimit(limit)} antes do horário.</p>
                )}
              </article>
            );
          })
        )}
      </section>

      {months.map(([label, items]) => (
        <section key={label} className="stack">
          <p className="section-title">{label}</p>
          {items.map((a) => {
            const r = reviewOf(a);
            const happened = a.status === 'completed' || (a.status === 'confirmed' && new Date(a.starts_at).getTime() <= Date.now());
            return (
              <article key={a.id} className="card appt-card stack">
                <div className="row between">
                  <strong>{formatDay(dayKeyOf(a.starts_at, tz))}</strong>
                  {a.status !== 'confirmed' && <StatusBadge status={a.status} />}
                </div>
                <div className="kv">
                  <div>
                    <div className="k">Horário</div>
                    <div className="v">
                      {timeOf(a.starts_at, tz)} – {timeOf(a.ends_at, tz)}
                    </div>
                  </div>
                  <div>
                    <div className="k">Profissional</div>
                    <div className="v row" style={{ gap: 8 }}>
                      <Avatar name={a.barber?.name ?? '?'} photo={a.barber?.photo} size={22} />
                      {a.barber?.name}
                    </div>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div className="k">Serviços</div>
                    <div className="v">{(a.items ?? []).map((i) => i.name).join(', ')}</div>
                  </div>
                </div>
                {happened && (
                  <>
                    <hr className="divider" />
                    <div className="row between">
                      <span className="text-2">{r ? 'Sua avaliação' : 'Avaliar atendimento'}</span>
                      <button className="link-btn" onClick={() => setRating(a)} aria-label="Avaliar">
                        <Stars value={r?.rating ?? 0} size={20} />
                      </button>
                    </div>
                    {r?.comment && <p className="small text-2">“{r.comment}”</p>}
                  </>
                )}
              </article>
            );
          })}
        </section>
      ))}

      {rating && (
        <RateSheet
          appt={rating}
          onClose={() => setRating(null)}
          onSaved={() => {
            setRating(null);
            toast('Obrigado pela avaliação!');
            void load();
          }}
        />
      )}
    </div>
  );
}

function RateSheet({ appt, onClose, onSaved }: { appt: Appointment; onClose: () => void; onSaved: () => void }) {
  const r = reviewOf(appt);
  const [value, setValue] = useState(r?.rating ?? 0);
  const [comment, setComment] = useState(r?.comment ?? '');
  const [saving, setSaving] = useState(false);
  const { toast } = useFeedback();
  async function save() {
    setSaving(true);
    const { error } = await supabase.rpc('rate_appointment', { p_id: appt.id, p_rating: value, p_comment: comment.trim() || null });
    setSaving(false);
    if (error) return toast(errorMessage(error), 'error');
    onSaved();
  }
  return (
    <Sheet
      title={`Como foi com ${appt.barber?.name ?? 'o barbeiro'}?`}
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!value || saving} onClick={save}>
          {saving && <Spinner small />} Enviar avaliação
        </button>
      }
    >
      <div className="stack" style={{ alignItems: 'center' }}>
        <StarsInput value={value} onChange={setValue} />
        <textarea
          className="textarea"
          placeholder="Conte como foi (opcional)"
          maxLength={500}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
    </Sheet>
  );
}
