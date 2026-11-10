import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, ListPlus, Pencil, Plus, Scissors } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { durationLabel } from '../lib/time';
import { centsToInput, money, parseMoney } from '../lib/format';
import type { Service } from '../lib/types';
import { Empty, Field, Loading, Spinner, Switch } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { AdminTitle } from './AdminLayout';

const DURATIONS = [10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480];

// Sugestões só com nome e tempo. O preço fica "a combinar" até o dono preencher.
const COMMON: { name: string; duration_minutes: number }[] = [
  { name: 'Corte', duration_minutes: 30 },
  { name: 'Barba', duration_minutes: 30 },
  { name: 'Corte e barba', duration_minutes: 60 },
  { name: 'Pezinho', duration_minutes: 15 },
  { name: 'Sobrancelha', duration_minutes: 15 },
  { name: 'Corte infantil', duration_minutes: 30 },
  { name: 'Pigmentação', duration_minutes: 30 },
  { name: 'Hidratação', duration_minutes: 30 },
  { name: 'Luzes', duration_minutes: 90 },
  { name: 'Platinado', duration_minutes: 120 },
];

/** Reordena trocando as posições e salva só o que mudou. */
export async function saveOrder<T extends { id: string; sort: number }>(table: 'services' | 'barbers', items: T[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const changes = next.map((it, i) => ({ id: it.id, sort: i + 1 })).filter((c) => items.find((x) => x.id === c.id)?.sort !== c.sort);
  const results = await Promise.all(changes.map((c) => supabase.from(table).update({ sort: c.sort }).eq('id', c.id)));
  return results.find((r) => r.error)?.error ?? null;
}

export function ServicesPage() {
  const { services, loading, reload } = useShop();
  const { toast } = useFeedback();
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [suggest, setSuggest] = useState(false);
  const [moving, setMoving] = useState(false);

  if (loading) return <Loading />;

  async function move(from: number, to: number) {
    setMoving(true);
    const error = await saveOrder('services', services, from, to);
    await reload();
    setMoving(false);
    if (error) toast(errorMessage(error), 'error');
  }

  const activeCount = services.filter((s) => s.active).length;

  return (
    <div className="stack lg">
      <AdminTitle title="Serviços" sub={services.length ? `${activeCount} ${activeCount === 1 ? 'serviço aparece' : 'serviços aparecem'} para os clientes` : 'O que os clientes podem agendar'}>
        <button className="btn outline" onClick={() => setSuggest(true)}>
          <ListPlus size={17} /> Serviços comuns
        </button>
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Plus size={17} /> Novo serviço
        </button>
      </AdminTitle>

      {services.length === 0 ? (
        <div className="card">
          <Empty icon={<Scissors size={32} />} title="Nenhum serviço cadastrado">
            <p>Cadastre um por um ou comece pela lista de serviços comuns de barbearia e depois coloque os preços.</p>
            <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn primary" onClick={() => setSuggest(true)}>
                <ListPlus size={17} /> Escolher serviços comuns
              </button>
              <button className="btn outline" onClick={() => setEditing('new')}>
                <Plus size={17} /> Novo serviço
              </button>
            </div>
          </Empty>
        </div>
      ) : (
        <div className="card">
          {services.map((s, i) => (
            <div key={s.id} className={`list-item${s.active ? '' : ' is-off'}`}>
              <div className="order-btns">
                <button className="icon-btn" aria-label={`Subir ${s.name}`} disabled={i === 0 || moving} onClick={() => move(i, i - 1)}>
                  <ArrowUp size={16} />
                </button>
                <button className="icon-btn" aria-label={`Descer ${s.name}`} disabled={i === services.length - 1 || moving} onClick={() => move(i, i + 1)}>
                  <ArrowDown size={16} />
                </button>
              </div>
              <button className="grow plain" onClick={() => setEditing(s)}>
                <span className="row" style={{ gap: 8 }}>
                  <strong className="ellipsis">{s.name}</strong>
                  {!s.active && <span className="badge">Oculto</span>}
                </span>
                <span className="small muted ellipsis" style={{ display: 'block' }}>
                  {durationLabel(s.duration_minutes)}
                  {s.description ? ` · ${s.description}` : ''}
                </span>
              </button>
              <strong className={s.price_cents == null ? 'muted' : ''} style={{ whiteSpace: 'nowrap' }}>
                {money(s.price_cents)}
              </strong>
              <button className="icon-btn" aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)}>
                <Pencil size={17} />
              </button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ServiceSheet
          service={editing === 'new' ? null : editing}
          nextSort={services.length + 1}
          onClose={() => setEditing(null)}
          onSaved={async (m) => {
            setEditing(null);
            await reload();
            toast(m);
          }}
        />
      )}
      {suggest && (
        <CommonSheet
          existing={services.map((s) => s.name.toLowerCase())}
          nextSort={services.length + 1}
          onClose={() => setSuggest(false)}
          onSaved={async (n) => {
            setSuggest(false);
            await reload();
            toast(`${n} ${n === 1 ? 'serviço adicionado' : 'serviços adicionados'}. Agora coloque os preços.`);
          }}
        />
      )}
    </div>
  );
}

function ServiceSheet({ service, nextSort, onClose, onSaved }: {
  service: Service | null;
  nextSort: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [duration, setDuration] = useState(service?.duration_minutes ?? 30);
  const [price, setPrice] = useState(centsToInput(service?.price_cents ?? null));
  const [active, setActive] = useState(service?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const options = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);

  async function save() {
    const errs: Record<string, string> = {};
    const cents = parseMoney(price);
    if (!name.trim()) errs.name = 'Informe o nome do serviço.';
    if (cents === 'invalid') errs.price = 'Use só números, por exemplo 35 ou 35,90.';
    setErrors(errs);
    if (Object.keys(errs).length || cents === 'invalid') return;
    const row = { name: name.trim(), description: description.trim() || null, duration_minutes: duration, price_cents: cents, active };
    setBusy('save');
    const { error } = service
      ? await supabase.from('services').update(row).eq('id', service.id)
      : await supabase.from('services').insert({ ...row, sort: nextSort });
    setBusy(null);
    if (error) return toast(errorMessage(error), 'error');
    onSaved(service ? 'Serviço salvo.' : 'Serviço criado.');
  }

  async function remove() {
    if (!service) return;
    const ok = await confirm({
      title: `Apagar ${service.name}?`,
      text: 'Se ele já foi usado em algum agendamento, o sistema não deixa apagar. Nesse caso, desligue "Aparece no app".',
      confirm: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    setBusy('delete');
    const { error } = await supabase.from('services').delete().eq('id', service.id);
    setBusy(null);
    if (error) return toast(errorMessage(error), 'error');
    onSaved('Serviço apagado.');
  }

  return (
    <Sheet
      title={service ? 'Editar serviço' : 'Novo serviço'}
      onClose={onClose}
      footer={
        <>
          {service && (
            <button className="btn danger" disabled={busy !== null} onClick={remove}>
              {busy === 'delete' && <Spinner small />} Apagar
            </button>
          )}
          <button className="btn primary" disabled={busy !== null} onClick={save}>
            {busy === 'save' && <Spinner small />} Salvar
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Nome" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Ex.: Corte degradê" />
        <Field
          label="Descrição (opcional)"
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex.: Máquina e tesoura, com lavagem"
        />
        <div className="form-row">
          <div className="field">
            <label htmlFor="sv-duration">Tempo</label>
            <select id="sv-duration" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {options.map((d) => (
                <option key={d} value={d}>
                  {durationLabel(d)}
                </option>
              ))}
            </select>
          </div>
          <Field
            label="Preço (R$)"
            inputMode="decimal"
            placeholder="A combinar"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            error={errors.price}
            hint="Em branco aparece como “a combinar”."
          />
        </div>
        <Switch checked={active} onChange={setActive} label="Aparece no app para os clientes" />
      </div>
    </Sheet>
  );
}

function CommonSheet({ existing, nextSort, onClose, onSaved }: {
  existing: string[];
  nextSort: number;
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const { toast } = useFeedback();
  const available = COMMON.filter((c) => !existing.includes(c.name.toLowerCase()));
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function save() {
    const rows = available
      .filter((c) => picked.includes(c.name))
      .map((c, i) => ({ name: c.name, duration_minutes: c.duration_minutes, price_cents: null, sort: nextSort + i }));
    setSaving(true);
    const { error } = await supabase.from('services').insert(rows);
    setSaving(false);
    if (error) return toast(errorMessage(error), 'error');
    onSaved(rows.length);
  }

  return (
    <Sheet
      title="Serviços comuns de barbearia"
      onClose={onClose}
      footer={
        <button className="btn primary" disabled={!picked.length || saving} onClick={save}>
          {saving && <Spinner small />} {picked.length ? `Adicionar ${picked.length}` : 'Escolha os serviços'}
        </button>
      }
    >
      {available.length === 0 ? (
        <p className="muted">Todos os serviços comuns já estão cadastrados.</p>
      ) : (
        <>
          <p className="text-2 small" style={{ marginBottom: 12 }}>
            Marque os que a barbearia faz. Eles entram sem preço (aparece “a combinar”) e você ajusta o preço e o tempo depois.
          </p>
          {available.map((c) => {
            const on = picked.includes(c.name);
            return (
              <button
                key={c.name}
                className="option"
                role="checkbox"
                aria-checked={on}
                onClick={() => setPicked((cur) => (on ? cur.filter((x) => x !== c.name) : [...cur, c.name]))}
              >
                <span className={`check${on ? ' on' : ''}`}>{on && <Check size={15} strokeWidth={3} />}</span>
                <span className="grow option-title">{c.name}</span>
                <span className="option-side muted">{durationLabel(c.duration_minutes)}</span>
              </button>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
