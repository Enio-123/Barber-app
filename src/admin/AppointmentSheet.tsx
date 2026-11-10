import { useState } from 'react';
import { CalendarClock, CalendarX2, Check, MessageCircle, Phone, RotateCcw, UserX } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { addDays, dayKeyOf, durationLabel, formatDay, timeOf, todayKey } from '../lib/time';
import { formatPhone, money, priceSummary, waLink } from '../lib/format';
import type { Appointment } from '../lib/types';
import { Avatar, Notice, Spinner, Stars, StatusBadge } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { reviewOf } from '../client/HistoryPage';

type Props = {
  appt: Appointment;
  tz: string;
  onClose: () => void;
  onChanged: (message: string) => void;
  onReschedule: () => void;
};

const when = (iso: string, tz: string) => `${formatDay(dayKeyOf(iso, tz), 'medium')}, ${timeOf(iso, tz)}`;

export function AppointmentSheet({ appt, tz, onClose, onChanged, onReschedule }: Props) {
  const { shop } = useShop();
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => PromiseLike<{ error: unknown }>, message: string) {
    setBusy(key);
    const { error } = await action();
    setBusy(null);
    if (error) return toast(errorMessage(error), 'error');
    onChanged(message);
  }

  const day = dayKeyOf(appt.starts_at, tz);

  if (appt.kind === 'block') {
    const s = new Date(appt.starts_at);
    const e = new Date(appt.ends_at);
    const startsMidnight = timeOf(appt.starts_at, tz) === '00:00';
    const endsMidnight = timeOf(appt.ends_at, tz) === '00:00';
    const lastDay = dayKeyOf(new Date(e.getTime() - 1).toISOString(), tz);
    const period =
      startsMidnight && endsMidnight
        ? lastDay === day
          ? `${formatDay(day)} · dia todo`
          : `De ${formatDay(day, 'medium')} até ${formatDay(lastDay, 'medium')} (dias inteiros)`
        : dayKeyOf(appt.ends_at, tz) === day
          ? `${formatDay(day)} · ${timeOf(s.toISOString(), tz)} – ${timeOf(e.toISOString(), tz)}`
          : `De ${when(appt.starts_at, tz)} até ${when(appt.ends_at, tz)}`;
    return (
      <Sheet
        title="Horário bloqueado"
        onClose={onClose}
        footer={
          <button
            className="btn danger"
            disabled={busy !== null}
            onClick={async () => {
              const ok = await confirm({
                title: 'Remover bloqueio?',
                text: 'O horário volta a aparecer livre para os clientes.',
                confirm: 'Remover',
                danger: true,
              });
              if (ok) void run('del', () => supabase.from('appointments').delete().eq('id', appt.id), 'Bloqueio removido.');
            }}
          >
            {busy === 'del' && <Spinner small />} Remover bloqueio
          </button>
        }
      >
        <div className="stack">
          <div className="kv">
            <div style={{ gridColumn: '1 / -1' }}>
              <div className="k">Período</div>
              <div className="v">{period}</div>
            </div>
            <div>
              <div className="k">Barbeiro</div>
              <div className="v">{appt.barber?.name}</div>
            </div>
            <div>
              <div className="k">Motivo</div>
              <div className="v">{appt.note || 'Não informado'}</div>
            </div>
          </div>
          <p className="hint">Durante o bloqueio, o app não mostra horários desse barbeiro.</p>
        </div>
      </Sheet>
    );
  }

  const items = appt.items ?? [];
  const minutes = items.reduce((a, i) => a + i.duration_minutes, 0);
  const started = new Date(appt.starts_at).getTime() <= Date.now();
  const review = reviewOf(appt);
  const firstName = (appt.client_name ?? '').split(' ')[0] || 'tudo bem';
  const shopName = shop?.name ?? 'barbearia';
  const confirmText = `Olá, ${firstName}! Passando para confirmar seu horário na ${shopName}: ${formatDay(day, 'medium')} às ${timeOf(appt.starts_at, tz)} com ${appt.barber?.name ?? ''}.`;
  const today = todayKey(tz);
  const isToday = day === today;
  const isTomorrow = day === addDays(today, 1);
  const reminder = isToday
    ? `Olá, ${firstName}! Lembrete do seu horário hoje às ${timeOf(appt.starts_at, tz)} na ${shopName}. Te esperamos!`
    : isTomorrow
      ? `Olá, ${firstName}! Lembrete do seu horário amanhã às ${timeOf(appt.starts_at, tz)} na ${shopName}. Te esperamos!`
      : confirmText;

  const setStatus = (status: 'confirmed' | 'completed' | 'no_show', message: string) =>
    run(status, () => supabase.rpc('set_appointment_status', { p_id: appt.id, p_status: status }), message);

  async function cancel() {
    const ok = await confirm({
      title: 'Cancelar este horário?',
      text: `${appt.client_name} · ${formatDay(day, 'medium')} às ${timeOf(appt.starts_at, tz)}. O horário fica livre no app. Se quiser, avise o cliente pelo WhatsApp.`,
      confirm: 'Cancelar horário',
      cancel: 'Voltar',
      danger: true,
    });
    if (ok) void run('cancel', () => supabase.rpc('cancel_appointment', { p_id: appt.id }), 'Horário cancelado.');
  }

  let footer = null;
  if (appt.status === 'confirmed' && started) {
    footer = (
      <>
        <button className="btn outline" disabled={busy !== null} onClick={() => setStatus('no_show', 'Marcado como falta.')}>
          {busy === 'no_show' ? <Spinner small /> : <UserX size={18} />} Não veio
        </button>
        <button className="btn primary" disabled={busy !== null} onClick={() => setStatus('completed', 'Atendimento concluído.')}>
          {busy === 'completed' ? <Spinner small /> : <Check size={18} />} Concluir
        </button>
      </>
    );
  } else if (appt.status === 'confirmed') {
    footer = (
      <>
        <button className="btn danger" disabled={busy !== null} onClick={cancel}>
          {busy === 'cancel' ? <Spinner small /> : <CalendarX2 size={18} />} Cancelar
        </button>
        <button className="btn outline" disabled={busy !== null} onClick={onReschedule}>
          <CalendarClock size={18} /> Remarcar
        </button>
      </>
    );
  } else if (appt.status === 'completed' || appt.status === 'no_show') {
    footer = (
      <button className="btn outline" disabled={busy !== null} onClick={() => setStatus('confirmed', 'Voltou para confirmado.')}>
        {busy === 'confirmed' ? <Spinner small /> : <RotateCcw size={18} />} Desfazer: voltar para confirmado
      </button>
    );
  }

  return (
    <Sheet title={appt.client_name || 'Agendamento'} onClose={onClose} footer={footer} wide>
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <StatusBadge status={appt.status} />
          <span className="badge">{appt.source === 'app' ? 'Agendado pelo app' : 'Marcado no painel'}</span>
        </div>

        <div className="kv">
          <div>
            <div className="k">Data</div>
            <div className="v">{formatDay(day)}</div>
          </div>
          <div>
            <div className="k">Horário</div>
            <div className="v">
              {timeOf(appt.starts_at, tz)} – {timeOf(appt.ends_at, tz)}
            </div>
          </div>
          <div>
            <div className="k">Barbeiro</div>
            <div className="v row" style={{ gap: 8 }}>
              <Avatar name={appt.barber?.name ?? '?'} photo={appt.barber?.photo} size={22} />
              {appt.barber?.name}
            </div>
          </div>
          <div>
            <div className="k">Cliente</div>
            <div className="v">{appt.client_phone ? formatPhone(appt.client_phone) : 'Sem telefone'}</div>
          </div>
        </div>

        <div className="card card-pad" style={{ background: 'var(--surface-2)' }}>
          {items.map((i) => (
            <div key={i.name} className="summary-line">
              <span>
                {i.name} <span className="muted">· {durationLabel(i.duration_minutes)}</span>
              </span>
              <span>{money(i.price_cents)}</span>
            </div>
          ))}
          <div className="summary-line total">
            <span>Total · {durationLabel(minutes)}</span>
            <span>{priceSummary(items)}</span>
          </div>
        </div>

        {appt.note && <Notice>Observação do cliente: {appt.note}</Notice>}

        {appt.client_phone && appt.status !== 'cancelled' && (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <a className="btn sm outline" href={waLink(appt.client_phone, started ? undefined : reminder)} target="_blank" rel="noreferrer">
              <MessageCircle size={16} /> {started ? 'WhatsApp' : 'Lembrar no WhatsApp'}
            </a>
            <a className="btn sm outline" href={`tel:${appt.client_phone}`}>
              <Phone size={16} /> Ligar
            </a>
          </div>
        )}

        {review && (
          <div className="stack" style={{ gap: 6 }}>
            <p className="section-title">Avaliação do cliente</p>
            <Stars value={review.rating} />
            {review.comment && <p className="text-2">“{review.comment}”</p>}
          </div>
        )}

        {appt.status === 'confirmed' && started && (
          <button className="link-btn" style={{ color: 'var(--danger)', alignSelf: 'flex-start' }} onClick={cancel} disabled={busy !== null}>
            Cancelar este horário
          </button>
        )}

        <p className="hint">
          {appt.source === 'app' ? 'Agendado pelo cliente' : 'Marcado pela barbearia'} em {when(appt.created_at, tz)}
          {appt.status === 'cancelled' && appt.cancelled_at
            ? ` · cancelado ${appt.cancelled_by === 'client' ? 'pelo cliente' : 'pela barbearia'} em ${when(appt.cancelled_at, tz)}`
            : ''}
        </p>
      </div>
    </Sheet>
  );
}
