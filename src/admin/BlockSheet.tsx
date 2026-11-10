import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { addDays, todayKey, zonedToDate, type DayKey } from '../lib/time';
import { Field, Spinner, Switch } from '../ui/kit';
import { Sheet } from '../ui/Sheet';

const REASONS = ['Almoço', 'Folga', 'Férias', 'Compromisso', 'Curso'];

/** Bloqueia um intervalo na agenda (de um barbeiro ou de todos): o app para de oferecer esses horários. */
export function BlockSheet({ tz, initial, onClose, onSaved }: {
  tz: string;
  initial?: { day?: DayKey; barberId?: string };
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { barbers } = useShop();
  const { toast } = useFeedback();
  const active = barbers.filter((b) => b.active);
  const [barber, setBarber] = useState(initial?.barberId ?? 'all');
  const [day, setDay] = useState<DayKey>(initial?.day ?? todayKey(tz));
  const [allDay, setAllDay] = useState(false);
  const [until, setUntil] = useState('');
  const [from, setFrom] = useState('12:00');
  const [to, setTo] = useState('13:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError('Escolha o dia.');
    let start: Date;
    let end: Date;
    if (allDay) {
      const last = until && until > day ? until : day;
      start = zonedToDate(day, '00:00', tz);
      end = zonedToDate(addDays(last, 1), '00:00', tz);
    } else {
      if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) return setError('Preencha o início e o fim.');
      if (to <= from) return setError('O fim precisa ser depois do início.');
      start = zonedToDate(day, from, tz);
      end = zonedToDate(day, to, tz);
    }
    setError(null);
    setSaving(true);
    const { data, error: e } = await supabase.rpc('admin_create_block', {
      p_barber_id: barber === 'all' ? null : barber,
      p_starts_at: start.toISOString(),
      p_ends_at: end.toISOString(),
      p_note: note.trim() || null,
    });
    setSaving(false);
    if (e) return toast(errorMessage(e), 'error');
    const n = Number(data);
    onSaved(n > 1 ? `Horário bloqueado para ${n} barbeiros.` : 'Horário bloqueado.');
  }

  return (
    <Sheet
      title="Bloquear horário"
      onClose={onClose}
      footer={
        <>
          <button className="btn outline" onClick={onClose}>
            Voltar
          </button>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving && <Spinner small />} Bloquear
          </button>
        </>
      }
    >
      <div className="form">
        <p className="text-2 small">Durante o bloqueio, o app não mostra esses horários para os clientes. Use para almoço, folga ou férias.</p>
        <div className="field">
          <label htmlFor="bl-barber">Quem</label>
          <select id="bl-barber" className="select" value={barber} onChange={(e) => setBarber(e.target.value)}>
            <option value="all">Todos os barbeiros</option>
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <Field label={allDay ? 'A partir do dia' : 'Dia'} type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <Switch checked={allDay} onChange={setAllDay} label="Dia inteiro" />
        {allDay ? (
          <Field
            label="Até o dia (opcional)"
            type="date"
            value={until}
            min={day}
            onChange={(e) => setUntil(e.target.value)}
            hint="Para férias ou vários dias seguidos. Em branco, bloqueia só um dia."
          />
        ) : (
          <div className="form-row">
            <Field label="Das" type="time" step={300} value={from} onChange={(e) => setFrom(e.target.value)} />
            <Field label="Até" type="time" step={300} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="bl-note">Motivo (opcional)</label>
          <input id="bl-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="chips" style={{ marginTop: 6 }}>
            {REASONS.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={note === r} onClick={() => setNote(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </Sheet>
  );
}
