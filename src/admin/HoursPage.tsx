import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { shortTime, WEEK_ORDER, WEEKDAYS_LONG } from '../lib/time';
import type { Hours } from '../lib/types';
import { Loading, Spinner, Switch } from '../ui/kit';
import { AdminTitle } from './AdminLayout';

type Row = { weekday: number; is_open: boolean; opens: string; closes: string; hasBreak: boolean; break_start: string; break_end: string };

const toRow = (h: Hours): Row => ({
  weekday: h.weekday,
  is_open: h.is_open,
  opens: shortTime(h.opens) || '09:00',
  closes: shortTime(h.closes) || '19:00',
  hasBreak: Boolean(h.break_start),
  break_start: shortTime(h.break_start) || '12:00',
  break_end: shortTime(h.break_end) || '13:00',
});

function problem(r: Row): string | null {
  if (!r.is_open) return null;
  if (!r.opens || !r.closes) return 'Preencha a abertura e o fechamento.';
  if (r.closes <= r.opens) return 'O fechamento precisa ser depois da abertura.';
  if (r.hasBreak) {
    if (!r.break_start || !r.break_end) return 'Preencha o início e o fim do intervalo.';
    if (r.break_end <= r.break_start) return 'O fim do intervalo precisa ser depois do início.';
    if (r.break_start <= r.opens || r.break_end >= r.closes) return 'O intervalo precisa ficar dentro do horário aberto.';
  }
  return null;
}

export function HoursPage() {
  const { hours, loading, reload } = useShop();
  const { toast } = useFeedback();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (hours.length) setRows(WEEK_ORDER.map((wd) => toRow(hours.find((h) => h.weekday === wd) ?? { weekday: wd, is_open: false, opens: null, closes: null, break_start: null, break_end: null })));
  }, [hours]);

  if (loading || !rows.length) return <Loading />;

  const set = (wd: number, patch: Partial<Row>) => setRows((cur) => cur.map((r) => (r.weekday === wd ? { ...r, ...patch } : r)));
  const copyToOpen = (src: Row) =>
    setRows((cur) =>
      cur.map((r) =>
        r.is_open && r.weekday !== src.weekday
          ? { ...r, opens: src.opens, closes: src.closes, hasBreak: src.hasBreak, break_start: src.break_start, break_end: src.break_end }
          : r,
      ),
    );

  const dirty = rows.some((r) => {
    const h = hours.find((x) => x.weekday === r.weekday);
    if (!h) return true;
    const o = toRow(h);
    if (o.is_open !== r.is_open) return true;
    if (!r.is_open) return false;
    return o.opens !== r.opens || o.closes !== r.closes || o.hasBreak !== r.hasBreak || (r.hasBreak && (o.break_start !== r.break_start || o.break_end !== r.break_end));
  });

  async function save() {
    setTried(true);
    if (rows.some((r) => problem(r))) return toast('Confira os horários marcados em vermelho.', 'error');
    setSaving(true);
    const results = await Promise.all(
      rows.map((r) =>
        supabase
          .from('business_hours')
          .update({
            is_open: r.is_open,
            opens: r.is_open ? r.opens : null,
            closes: r.is_open ? r.closes : null,
            break_start: r.is_open && r.hasBreak ? r.break_start : null,
            break_end: r.is_open && r.hasBreak ? r.break_end : null,
          })
          .eq('weekday', r.weekday),
      ),
    );
    setSaving(false);
    const failed = results.find((x) => x.error);
    if (failed?.error) return toast(errorMessage(failed.error), 'error');
    await reload();
    setTried(false);
    toast('Horários salvos. O app já mostra os novos horários.');
  }

  return (
    <div className="stack lg">
      <AdminTitle title="Horários" sub="Quando a barbearia atende. O app só oferece horários dentro destes períodos." />
      <div className="card">
        {rows.map((r) => {
          const err = tried ? problem(r) : null;
          return (
            <div key={r.weekday} className="hours-row">
              <div className="stack" style={{ gap: 6 }}>
                <strong>{WEEKDAYS_LONG[r.weekday]}</strong>
                <Switch checked={r.is_open} onChange={(v) => set(r.weekday, { is_open: v })} label={r.is_open ? 'Aberto' : 'Fechado'} />
              </div>
              {r.is_open ? (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="times">
                    <input className="input" type="time" step={300} value={r.opens} onChange={(e) => set(r.weekday, { opens: e.target.value })} aria-label={`${WEEKDAYS_LONG[r.weekday]}: abre às`} />
                    <span className="muted">até</span>
                    <input className="input" type="time" step={300} value={r.closes} onChange={(e) => set(r.weekday, { closes: e.target.value })} aria-label={`${WEEKDAYS_LONG[r.weekday]}: fecha às`} />
                  </div>
                  <Switch checked={r.hasBreak} onChange={(v) => set(r.weekday, { hasBreak: v })} label="Intervalo (almoço)" />
                  {r.hasBreak && (
                    <div className="times">
                      <input className="input" type="time" step={300} value={r.break_start} onChange={(e) => set(r.weekday, { break_start: e.target.value })} aria-label={`${WEEKDAYS_LONG[r.weekday]}: intervalo começa`} />
                      <span className="muted">até</span>
                      <input className="input" type="time" step={300} value={r.break_end} onChange={(e) => set(r.weekday, { break_end: e.target.value })} aria-label={`${WEEKDAYS_LONG[r.weekday]}: intervalo termina`} />
                    </div>
                  )}
                  {err && <span className="error-text">{err}</span>}
                  {rows.filter((x) => x.is_open).length > 1 && (
                    <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => copyToOpen(r)}>
                      <Copy size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                      Usar este horário nos outros dias abertos
                    </button>
                  )}
                </div>
              ) : (
                <p className="muted" style={{ paddingTop: 2 }}>Sem atendimento</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="sticky-actions">
        <button className="btn primary" disabled={saving || !dirty} onClick={save}>
          {saving && <Spinner small />} {dirty ? 'Salvar horários' : 'Horários salvos'}
        </button>
      </div>
    </div>
  );
}
