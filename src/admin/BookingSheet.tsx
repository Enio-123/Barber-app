import { useEffect, useMemo, useState } from 'react';
import { UserRound, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useShop } from '../state/shop';
import { useAuth } from '../state/auth';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { dayKeyOf, durationLabel, formatDay, hhmmToMin, minToHhmm, timeOf, todayKey, weekdayOf, zonedToDate, type DayKey } from '../lib/time';
import { formatPhone, maskPhone, onlyDigits, priceSummary, validPhone } from '../lib/format';
import type { AdminClient, Appointment } from '../lib/types';
import { Field, Notice, Spinner } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { fetchDay, minuteIn } from './data';

export type PickedClient = { id: string | null; name: string; phone: string | null };

type Props = {
  tz: string;
  initial?: { barberId?: string; start?: string; day?: DayKey; client?: PickedClient };
  /** Quando vem preenchido, a tela remarca este agendamento em vez de criar outro. */
  reschedule?: Appointment;
  onClose: () => void;
  onSaved: (id: string, message: string, day: DayKey) => void;
};

type Busy = { id: string; s: number; e: number; label: string };

/** Novo agendamento feito pela barbearia (cliente do balcão, ligação, WhatsApp) ou remarcação. */
export function BookingSheet({ tz, initial, reschedule, onClose, onSaved }: Props) {
  const { shop, barbers, services, hours } = useShop();
  const { can, profile } = useAuth();
  const { toast } = useFeedback();
  const today = todayKey(tz);
  const startIso = reschedule?.starts_at ?? initial?.start;
  const barberOptions = barbers.filter(
    (b) => (b.active || b.id === reschedule?.barber_id) && (can.agendaAll || b.id === profile?.barber_id),
  );
  const activeServices = services.filter((s) => s.active);

  const [barberId, setBarberId] = useState(reschedule?.barber_id ?? initial?.barberId ?? barberOptions[0]?.id ?? '');
  const [day, setDay] = useState<DayKey>(startIso ? dayKeyOf(startIso, tz) : initial?.day ?? today);
  const [time, setTime] = useState(startIso ? timeOf(startIso, tz) : '');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [name, setName] = useState(initial?.client?.name ?? '');
  const [phone, setPhone] = useState(formatPhone(initial?.client?.phone));
  const [clientId, setClientId] = useState<string | null>(initial?.client?.id ?? null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const chosen = activeServices.filter((s) => serviceIds.includes(s.id));
  const duration = reschedule
    ? Math.round((new Date(reschedule.ends_at).getTime() - new Date(reschedule.starts_at).getTime()) / 60000)
    : chosen.reduce((a, s) => a + s.duration_minutes, 0);
  const slot = shop?.slot_minutes ?? 30;
  const len = duration || slot;

  const canPickClient = can.clients;
  useEffect(() => {
    if (reschedule || !canPickClient) return;
    let alive = true;
    supabase.rpc('admin_clients').then(({ data }) => alive && setClients((data as AdminClient[] | null) ?? []));
    return () => {
      alive = false;
    };
  }, [reschedule, canPickClient]);

  const rescheduleId = reschedule?.id;
  useEffect(() => {
    if (!barberId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    let alive = true;
    setBusy(null);
    fetchDay(day, tz, barberId).then(({ data }) => {
      if (!alive) return;
      const dayStart = zonedToDate(day, '00:00', tz).getTime();
      setBusy(
        data
          .filter((a) => a.status !== 'cancelled' && a.id !== rescheduleId)
          .map((a) => ({
            id: a.id,
            s: minuteIn(a.starts_at, dayStart),
            e: minuteIn(a.ends_at, dayStart),
            label: a.kind === 'block' ? a.note || 'Bloqueado' : a.client_name || 'Cliente',
          })),
      );
    });
    return () => {
      alive = false;
    };
  }, [barberId, day, tz, rescheduleId]);

  const h = hours.find((x) => x.weekday === weekdayOf(day));
  const nowMin = day === today ? minuteIn(new Date().toISOString(), zonedToDate(day, '00:00', tz).getTime()) : -1;
  const chips = useMemo(() => {
    const out: { m: number; free: boolean }[] = [];
    if (!h?.is_open || day < today) return out;
    const o = hhmmToMin(h.opens);
    const c = hhmmToMin(h.closes);
    const bs = h.break_start ? hhmmToMin(h.break_start) : null;
    const be = h.break_end ? hhmmToMin(h.break_end) : null;
    for (let m = o; m + len <= c; m += slot) {
      if (bs != null && be != null && m < be && m + len > bs) continue;
      if (m + len <= nowMin) continue;
      out.push({ m, free: !(busy ?? []).some((r) => m < r.e && m + len > r.s) });
    }
    return out;
  }, [h, day, today, len, slot, busy, nowMin]);

  const tMin = /^\d{2}:\d{2}$/.test(time) ? hhmmToMin(time) : null;
  const conflict = tMin != null ? (busy ?? []).find((r) => tMin < r.e && tMin + len > r.s) : undefined;

  const q = name.trim().toLowerCase();
  const qDigits = onlyDigits(name);
  const suggestions =
    !clientId && q.length >= 2
      ? clients
          .filter((c) => c.full_name.toLowerCase().includes(q) || (qDigits.length >= 4 && (c.phone ?? '').includes(qDigits)))
          .slice(0, 5)
      : [];

  async function save() {
    const errs: Record<string, string> = {};
    if (!barberId) errs.barber = 'Escolha o barbeiro.';
    if (!reschedule && !serviceIds.length) errs.services = 'Escolha pelo menos um serviço.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) errs.day = 'Escolha o dia.';
    if (tMin == null) errs.time = 'Escolha o horário.';
    if (!reschedule) {
      if (name.trim().length < 2) errs.name = 'Informe o nome do cliente.';
      if (phone && !validPhone(phone)) errs.phone = 'WhatsApp com DDD, ou deixe em branco.';
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const start = zonedToDate(day, time, tz);
    setSaving(true);
    if (reschedule) {
      const { error } = await supabase.rpc('admin_reschedule', {
        p_id: reschedule.id,
        p_barber_id: barberId,
        p_starts_at: start.toISOString(),
      });
      setSaving(false);
      if (error) return toast(errorMessage(error), 'error');
      onSaved(reschedule.id, 'Horário remarcado. Avise o cliente pelo WhatsApp.', day);
      return;
    }
    const { data, error } = await supabase.rpc('admin_create_booking', {
      p_barber_id: barberId,
      p_service_ids: serviceIds,
      p_starts_at: start.toISOString(),
      p_client_name: name.trim(),
      p_client_phone: phone ? onlyDigits(phone) : null,
      p_client_id: clientId,
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (error) return toast(errorMessage(error), 'error');
    onSaved(data as string, `Horário marcado para ${name.trim().split(' ')[0]}.`, day);
  }

  return (
    <Sheet
      title={reschedule ? `Remarcar ${reschedule.client_name ?? ''}` : 'Novo agendamento'}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving && <Spinner small />} {reschedule ? 'Salvar novo horário' : 'Marcar horário'}
          </button>
        </>
      }
    >
      <div className="form">
        {!reschedule && (
          <div className="field">
            <label htmlFor="bk-name">Cliente</label>
            <div className="input-wrap">
              <input
                id="bk-name"
                className="input"
                autoComplete="off"
                placeholder={canPickClient ? 'Nome ou WhatsApp de quem já é cliente' : 'Nome do cliente'}
                value={name}
                maxLength={80}
                aria-invalid={errors.name ? true : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  setClientId(null);
                }}
              />
              {clientId && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Trocar cliente"
                  onClick={() => {
                    setClientId(null);
                    setName('');
                    setPhone('');
                  }}
                >
                  <X size={18} />
                </button>
              )}
            </div>
            {errors.name ? (
              <span className="error-text">{errors.name}</span>
            ) : clientId ? (
              <span className="hint">Cliente cadastrado no app: o horário aparece na conta dele.</span>
            ) : (
              <span className="hint">Cliente novo? Escreva o nome. Ele não precisa ter o app.</span>
            )}
            {suggestions.length > 0 && (
              <div className="suggest">
                {suggestions.map((c) => (
                  <button
                    key={(c.client_id ?? '') + c.full_name + (c.phone ?? '')}
                    type="button"
                    className="suggest-item"
                    onClick={() => {
                      setClientId(c.client_id);
                      setName(c.full_name);
                      setPhone(formatPhone(c.phone));
                    }}
                  >
                    <UserRound size={16} />
                    <span className="grow ellipsis">{c.full_name}</span>
                    <span className="small muted">{c.phone ? formatPhone(c.phone) : c.client_id ? 'app' : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!reschedule && (
          <Field
            label="WhatsApp (opcional)"
            type="tel"
            inputMode="tel"
            placeholder="(84) 99999-9999"
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            error={errors.phone}
          />
        )}

        {!reschedule ? (
          <div className="field">
            <span className="label">Serviços</span>
            <div className="chips">
              {activeServices.map((s) => {
                const on = serviceIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() => setServiceIds((cur) => (on ? cur.filter((x) => x !== s.id) : [...cur, s.id]))}
                  >
                    {s.name} · {durationLabel(s.duration_minutes)}
                  </button>
                );
              })}
            </div>
            {errors.services ? (
              <span className="error-text">{errors.services}</span>
            ) : chosen.length ? (
              <span className="hint">
                {durationLabel(duration)} · {priceSummary(chosen)}
              </span>
            ) : null}
          </div>
        ) : (
          <Notice>
            {(reschedule.items ?? []).map((i) => i.name).join(', ')} · {durationLabel(duration)}. Hoje está marcado para{' '}
            {formatDay(dayKeyOf(reschedule.starts_at, tz), 'medium')} às {timeOf(reschedule.starts_at, tz)}.
          </Notice>
        )}

        <div className="form-row">
          <div className="field">
            <label htmlFor="bk-barber">Barbeiro</label>
            <select id="bk-barber" className="select" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
              {barberOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {errors.barber && <span className="error-text">{errors.barber}</span>}
          </div>
          <Field label="Dia" type="date" value={day} onChange={(e) => setDay(e.target.value)} error={errors.day} />
        </div>

        <div className="field">
          <span className="label">Horário</span>
          {day < today && <Notice>Esse dia já passou. Use só para registrar um atendimento que já aconteceu.</Notice>}
          {day >= today && !h?.is_open && (
            <Notice>Pelo horário cadastrado, a barbearia fica fechada nesse dia. Você ainda pode marcar no horário que digitar abaixo.</Notice>
          )}
          {chips.length > 0 && (
            <div className="slots" style={{ marginBottom: 4 }}>
              {chips.map((c) => {
                const v = minToHhmm(c.m);
                return (
                  <button key={c.m} type="button" className="slot" disabled={!c.free} aria-pressed={time === v} onClick={() => setTime(v)}>
                    {v}
                  </button>
                );
              })}
            </div>
          )}
          <div className="row">
            <input
              className="input"
              type="time"
              step={300}
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Outro horário"
              aria-invalid={errors.time ? true : undefined}
              style={{ width: 150 }}
            />
            <span className="small muted">{tMin != null && duration ? `termina às ${minToHhmm((tMin + duration) % 1440)}` : 'ou digite outro horário'}</span>
          </div>
          {errors.time && <span className="error-text">{errors.time}</span>}
          {conflict && (
            <span className="error-text">
              Ocupado das {minToHhmm(Math.max(0, conflict.s))} às {minToHhmm(Math.min(1439, conflict.e))} ({conflict.label}).
            </span>
          )}
          {busy && busy.length > 0 && (
            <span className="hint">
              Ocupado nesse dia:{' '}
              {busy
                .map((r) => (r.s <= 0 && r.e >= 1440 ? 'o dia todo' : `${minToHhmm(Math.max(0, r.s))}–${minToHhmm(Math.min(1439, r.e))}`))
                .join(', ')}
            </span>
          )}
        </div>

        {!reschedule && (
          <div className="field">
            <label htmlFor="bk-note">Observação (opcional)</label>
            <textarea id="bk-note" className="textarea" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
