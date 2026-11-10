import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarPlus, Check, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { tzOf, useShop } from '../state/shop';
import { dayKeyOf, durationLabel, formatDay, timeOf } from '../lib/time';
import { money, waLink } from '../lib/format';
import { downloadIcs } from '../lib/ics';
import type { Appointment } from '../lib/types';
import { Avatar, Empty, Loading } from '../ui/kit';
import { APPT_SELECT } from './HistoryPage';

export function BookedPage() {
  const { id } = useParams();
  const { shop } = useShop();
  const tz = tzOf(shop);
  const [appt, setAppt] = useState<Appointment | null | undefined>(undefined);

  useEffect(() => {
    supabase
      .from('appointments')
      .select(APPT_SELECT)
      .eq('id', id ?? '')
      .maybeSingle()
      .then(({ data }) => setAppt((data as unknown as Appointment) ?? null));
  }, [id]);

  if (appt === undefined) return <Loading />;
  if (!appt) return <Empty title="Agendamento não encontrado" />;

  const items = appt.items ?? [];
  const minutes = items.reduce((a, i) => a + i.duration_minutes, 0);
  const day = formatDay(dayKeyOf(appt.starts_at, tz));
  const time = timeOf(appt.starts_at, tz);

  return (
    <div className="stack lg">
      <div style={{ textAlign: 'center' }} className="stack">
        <span className="hero-ok">
          <Check size={32} strokeWidth={2.5} />
        </span>
        <h1 className="page-title">Horário confirmado</h1>
        <p className="muted">Te esperamos na {shop?.name ?? 'barbearia'}.</p>
      </div>

      <div className="card card-pad stack">
        <div className="row">
          <Avatar name={appt.barber?.name ?? '?'} photo={appt.barber?.photo} size={44} />
          <div>
            <div className="small muted">Profissional</div>
            <strong>{appt.barber?.name}</strong>
          </div>
        </div>
        <hr className="divider" />
        <div className="kv">
          <div>
            <div className="k">Data</div>
            <div className="v">{day}</div>
          </div>
          <div>
            <div className="k">Horário</div>
            <div className="v">
              {time} – {timeOf(appt.ends_at, tz)}
            </div>
          </div>
        </div>
        <hr className="divider" />
        {items.map((i) => (
          <div key={i.name} className="summary-line">
            <span>{i.name}</span>
            <span>{money(i.price_cents)}</span>
          </div>
        ))}
        <div className="summary-line total">
          <span>Total · {durationLabel(minutes)}</span>
          <span>{appt.total_cents != null && appt.total_cents > 0 ? money(appt.total_cents) : 'A combinar'}</span>
        </div>
      </div>

      <div className="stack">
        <button
          className="btn outline block"
          onClick={() =>
            downloadIcs({
              id: appt.id,
              title: `${shop?.name ?? 'Barbearia'} · ${items.map((i) => i.name).join(', ')}`,
              start: appt.starts_at,
              end: appt.ends_at,
              description: `Com ${appt.barber?.name ?? ''}`,
              location: shop?.address,
            })
          }
        >
          <CalendarPlus size={18} /> Salvar na agenda do celular
        </button>
        {shop?.whatsapp && (
          <a
            className="btn outline block"
            target="_blank"
            rel="noreferrer"
            href={waLink(shop.whatsapp, `Olá! Agendei pelo app: ${day} às ${time} com ${appt.barber?.name ?? ''}.`)}
          >
            <MessageCircle size={18} /> Avisar no WhatsApp
          </a>
        )}
        <Link className="btn primary block" to="/historico">
          Ver meus horários
        </Link>
      </div>
    </div>
  );
}
