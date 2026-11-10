import { useCallback, useEffect, useMemo, useState } from 'react';
import { Star, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { tzOf, useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { dayKeyOf, formatDay } from '../lib/time';
import type { AdminReview } from '../lib/types';
import { Avatar, Empty, Loading, Notice, Stars } from '../ui/kit';
import { AdminTitle } from './AdminLayout';

export function ReviewsPage() {
  const { shop, barbers, reload: reloadShop } = useShop();
  const { toast, confirm } = useFeedback();
  const tz = tzOf(shop);
  const [list, setList] = useState<AdminReview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('reviews')
      .select('appointment_id, rating, comment, created_at, barber_id, appointment:appointments(starts_at, client_name)')
      .order('created_at', { ascending: false })
      .limit(500);
    setFailed(Boolean(error));
    setList((data as unknown as AdminReview[] | null) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => (list ?? []).filter((r) => filter === 'all' || r.barber_id === filter), [list, filter]);
  const average = shown.length ? shown.reduce((a, r) => a + r.rating, 0) / shown.length : 0;
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, count: shown.filter((r) => r.rating === n).length }));

  if (list === null) return <Loading />;

  async function remove(r: AdminReview) {
    const ok = await confirm({
      title: 'Apagar esta avaliação?',
      text: 'Use só para comentário ofensivo ou feito por engano. A nota sai da média do barbeiro.',
      confirm: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('reviews').delete().eq('appointment_id', r.appointment_id);
    if (error) return toast(errorMessage(error), 'error');
    toast('Avaliação apagada.');
    await Promise.all([load(), reloadShop()]);
  }

  const reviewed = barbers.filter((b) => list.some((r) => r.barber_id === b.id));

  return (
    <div className="stack lg">
      <AdminTitle title="Avaliações" sub="O que os clientes acharam depois do atendimento." />
      {failed && <Notice tone="danger">Não foi possível carregar as avaliações.</Notice>}

      {list.length === 0 ? (
        <div className="card">
          <Empty icon={<Star size={32} />} title="Nenhuma avaliação ainda">
            <p>Depois do horário, o cliente pode dar de 1 a 5 estrelas em "Meus horários". As notas aparecem aqui.</p>
          </Empty>
        </div>
      ) : (
        <>
          {reviewed.length > 1 && (
            <div className="chips" role="group" aria-label="Filtrar por barbeiro">
              <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                Todos
              </button>
              {reviewed.map((b) => (
                <button key={b.id} className="chip chip-avatar" aria-pressed={filter === b.id} onClick={() => setFilter(b.id)}>
                  <Avatar name={b.name} photo={b.photo} size={22} />
                  {b.name}
                </button>
              ))}
            </div>
          )}

          <div className="card card-pad review-summary">
            <div>
              <div className="review-avg">{average.toFixed(1).replace('.', ',')}</div>
              <Stars value={average} />
              <p className="small muted" style={{ marginTop: 4 }}>
                {shown.length} {shown.length === 1 ? 'avaliação' : 'avaliações'}
              </p>
            </div>
            <div className="review-bars">
              {dist.map((d) => (
                <div key={d.n} className="review-bar">
                  <span className="small muted">{d.n}</span>
                  <span className="bar">
                    <span style={{ width: `${shown.length ? (d.count / shown.length) * 100 : 0}%` }} />
                  </span>
                  <span className="small muted">{d.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            {shown.map((r) => {
              const b = barbers.find((x) => x.id === r.barber_id);
              return (
                <div key={r.appointment_id} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <Avatar name={r.appointment?.client_name || '?'} size={38} />
                  <div className="grow stack" style={{ gap: 4 }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <strong>{r.appointment?.client_name || 'Cliente'}</strong>
                      <Stars value={r.rating} size={14} />
                    </div>
                    {r.comment && <p className="text-2">{r.comment}</p>}
                    <p className="small muted">
                      Com {b?.name ?? 'barbeiro removido'}
                      {r.appointment ? ` · atendimento de ${formatDay(dayKeyOf(r.appointment.starts_at, tz), 'medium')}` : ''}
                    </p>
                  </div>
                  <button className="icon-btn" aria-label="Apagar avaliação" onClick={() => remove(r)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
