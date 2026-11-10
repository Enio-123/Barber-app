import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Download, MessageCircle, Search, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { tzOf, useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { dayKeyOf, formatDay, timeOf } from '../lib/time';
import { formatPhone, waLink } from '../lib/format';
import type { AdminClient, Appointment } from '../lib/types';
import { APPT_SELECT } from '../client/HistoryPage';
import { Avatar, Empty, Loading, Notice, Segmented, StatusBadge } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { AdminTitle } from './AdminLayout';
import { BookingSheet } from './BookingSheet';
import { downloadText } from './data';

type Kind = 'all' | 'app' | 'balcao';

const keyOf = (c: AdminClient) => c.client_id ?? `w:${c.phone ?? c.full_name}`;

export function ClientsPage() {
  const { shop } = useShop();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const tz = tzOf(shop);
  const [list, setList] = useState<AdminClient[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [open, setOpen] = useState<AdminClient | null>(null);
  const [booking, setBooking] = useState<AdminClient | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_clients');
    setFailed(Boolean(error));
    setList((data as AdminClient[] | null) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const digits = t.replace(/\D/g, '');
    return (list ?? []).filter((c) => {
      if (kind === 'app' && !c.client_id) return false;
      if (kind === 'balcao' && c.client_id) return false;
      if (!t) return true;
      return (
        c.full_name.toLowerCase().includes(t) ||
        (c.email ?? '').toLowerCase().includes(t) ||
        (digits.length >= 3 && (c.phone ?? '').includes(digits))
      );
    });
  }, [list, q, kind]);

  if (list === null) return <Loading />;

  const dateOf = (iso: string | null) => (iso ? formatDay(dayKeyOf(iso, tz), 'short') : '');

  function exportCsv() {
    const rows = [
      ['Nome', 'WhatsApp', 'E-mail', 'Origem', 'Atendimentos', 'Faltas', 'Última visita', 'Próximo horário'],
      ...filtered.map((c) => [
        c.full_name,
        c.phone ? formatPhone(c.phone) : '',
        c.email ?? '',
        c.client_id ? 'App' : 'Balcão',
        String(c.completed),
        String(c.no_shows),
        dateOf(c.last_visit),
        c.next_visit ? `${dateOf(c.next_visit)} ${timeOf(c.next_visit, tz)}` : '',
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(';')).join('\r\n');
    downloadText('clientes-easy-cut.csv', csv);
    toast('Lista de clientes baixada.');
  }

  const total = list.length;
  const fromApp = list.filter((c) => c.client_id).length;

  return (
    <div className="stack lg">
      <AdminTitle title="Clientes" sub={`${total} ${total === 1 ? 'cliente' : 'clientes'} · ${fromApp} com conta no app`}>
        <button className="btn outline" onClick={exportCsv} disabled={!filtered.length}>
          <Download size={17} /> Exportar planilha
        </button>
      </AdminTitle>

      {failed && <Notice tone="danger">Não foi possível carregar os clientes. Tente de novo.</Notice>}

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="input-wrap grow" style={{ minWidth: 220 }}>
          <input className="input with-icon" placeholder="Buscar por nome, WhatsApp ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
          <Search size={18} className="input-icon" />
        </div>
        <div style={{ width: 300, maxWidth: '100%' }}>
          <Segmented<Kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'app', label: 'App' },
              { value: 'balcao', label: 'Balcão' },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <Empty icon={<Users size={32} />} title={total ? 'Nenhum cliente encontrado' : 'Ainda não tem clientes'}>
            <p>{total ? 'Tente buscar de outro jeito.' : 'Quem criar conta no app ou for marcado no painel aparece aqui.'}</p>
          </Empty>
        </div>
      ) : (
        <div className="card">
          {filtered.map((c) => (
            <button key={keyOf(c)} className="list-item" onClick={() => setOpen(c)}>
              <Avatar name={c.full_name || '?'} size={40} />
              <span className="grow">
                <span className="row" style={{ gap: 8 }}>
                  <strong className="ellipsis">{c.full_name || 'Sem nome'}</strong>
                  {!c.client_id && <span className="badge">Balcão</span>}
                </span>
                <span className="small muted ellipsis" style={{ display: 'block' }}>
                  {[c.phone ? formatPhone(c.phone) : null, c.email].filter(Boolean).join(' · ') || 'Sem contato'}
                </span>
              </span>
              <span className="client-stats">
                <span>
                  <strong>{c.completed}</strong> {c.completed === 1 ? 'atendimento' : 'atendimentos'}
                </span>
                {c.next_visit ? (
                  <span className="badge accent">Volta {formatDay(dayKeyOf(c.next_visit, tz), 'medium')}</span>
                ) : c.last_visit ? (
                  <span className="small muted">Última vez {dateOf(c.last_visit)}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      )}

      {open && (
        <ClientSheet
          client={open}
          tz={tz}
          onClose={() => setOpen(null)}
          onBook={() => {
            setBooking(open);
            setOpen(null);
          }}
        />
      )}
      {booking && (
        <BookingSheet
          tz={tz}
          initial={{ client: { id: booking.client_id, name: booking.full_name, phone: booking.phone } }}
          onClose={() => setBooking(null)}
          onSaved={(_id, m, d) => {
            setBooking(null);
            toast(m);
            void load();
            navigate(`/admin?dia=${d}`);
          }}
        />
      )}
    </div>
  );
}

function ClientSheet({ client, tz, onClose, onBook }: { client: AdminClient; tz: string; onClose: () => void; onBook: () => void }) {
  const [history, setHistory] = useState<Appointment[] | null>(null);

  useEffect(() => {
    let alive = true;
    let q = supabase.from('appointments').select(APPT_SELECT).eq('kind', 'booking').order('starts_at', { ascending: false }).limit(30);
    q = client.client_id
      ? q.eq('client_id', client.client_id)
      : client.phone
        ? q.is('client_id', null).eq('client_phone', client.phone)
        : q.is('client_id', null).eq('client_name', client.full_name);
    q.then(({ data }) => alive && setHistory((data as unknown as Appointment[] | null) ?? []));
    return () => {
      alive = false;
    };
  }, [client]);

  return (
    <Sheet
      title={client.full_name || 'Cliente'}
      onClose={onClose}
      wide
      footer={
        <>
          {client.phone && (
            <a className="btn outline" href={waLink(client.phone)} target="_blank" rel="noreferrer">
              <MessageCircle size={18} /> WhatsApp
            </a>
          )}
          <button className="btn primary" onClick={onBook}>
            <CalendarPlus size={18} /> Marcar horário
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="kv">
          <div>
            <div className="k">WhatsApp</div>
            <div className="v">{client.phone ? formatPhone(client.phone) : 'Não informado'}</div>
          </div>
          <div>
            <div className="k">{client.client_id ? 'E-mail da conta' : 'Origem'}</div>
            <div className="v ellipsis">{client.client_id ? client.email : 'Marcado no balcão'}</div>
          </div>
          <div>
            <div className="k">Atendimentos</div>
            <div className="v">{client.completed}</div>
          </div>
          <div>
            <div className="k">Faltas</div>
            <div className="v">{client.no_shows}</div>
          </div>
        </div>
        <p className="section-title" style={{ marginTop: 6 }}>
          Histórico
        </p>
        {history === null ? (
          <div className="skeleton" style={{ height: 120 }} />
        ) : history.length === 0 ? (
          <p className="muted">Nenhum horário ainda.</p>
        ) : (
          <div className="card">
            {history.map((a) => (
              <div key={a.id} className="list-item">
                <span className="grow">
                  <strong style={{ display: 'block' }}>
                    {formatDay(dayKeyOf(a.starts_at, tz), 'medium')} · {timeOf(a.starts_at, tz)}
                  </strong>
                  <span className="small muted ellipsis" style={{ display: 'block' }}>
                    {(a.items ?? []).map((i) => i.name).join(', ')} · {a.barber?.name}
                  </span>
                </span>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}
