import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Camera, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { photoToDataUrl } from '../lib/image';
import type { Barber } from '../lib/types';
import { Avatar, Empty, Field, Loading, Spinner, Stars, Switch } from '../ui/kit';
import { Sheet } from '../ui/Sheet';
import { AdminTitle } from './AdminLayout';
import { saveOrder } from './ServicesPage';

export function BarbersPage() {
  const { barbers, ratings, loading, reload } = useShop();
  const { toast } = useFeedback();
  const [editing, setEditing] = useState<Barber | 'new' | null>(null);
  const [moving, setMoving] = useState(false);

  if (loading) return <Loading />;

  async function move(from: number, to: number) {
    setMoving(true);
    const error = await saveOrder('barbers', barbers, from, to);
    await reload();
    setMoving(false);
    if (error) toast(errorMessage(error), 'error');
  }

  return (
    <div className="stack lg">
      <AdminTitle title="Barbeiros" sub="Quem atende. Cada um tem a própria agenda.">
        <button className="btn primary" onClick={() => setEditing('new')}>
          <Plus size={17} /> Novo barbeiro
        </button>
      </AdminTitle>

      {barbers.length === 0 ? (
        <div className="card">
          <Empty icon={<UserRound size={32} />} title="Nenhum barbeiro cadastrado">
            <p>Cadastre quem atende na barbearia. Os clientes escolhem com quem querem cortar, ou "sem preferência".</p>
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus size={17} /> Cadastrar barbeiro
            </button>
          </Empty>
        </div>
      ) : (
        <div className="card">
          {barbers.map((b, i) => {
            const r = ratings[b.id];
            return (
              <div key={b.id} className={`list-item${b.active ? '' : ' is-off'}`}>
                <div className="order-btns">
                  <button className="icon-btn" aria-label={`Subir ${b.name}`} disabled={i === 0 || moving} onClick={() => move(i, i - 1)}>
                    <ArrowUp size={16} />
                  </button>
                  <button className="icon-btn" aria-label={`Descer ${b.name}`} disabled={i === barbers.length - 1 || moving} onClick={() => move(i, i + 1)}>
                    <ArrowDown size={16} />
                  </button>
                </div>
                <Avatar name={b.name} photo={b.photo} size={46} />
                <button className="grow plain" onClick={() => setEditing(b)}>
                  <span className="row" style={{ gap: 8 }}>
                    <strong className="ellipsis">{b.name}</strong>
                    {!b.active && <span className="badge">Fora da agenda</span>}
                  </span>
                  <span className="small muted ellipsis" style={{ display: 'block' }}>
                    {b.bio || 'Sem descrição'}
                  </span>
                </button>
                {r && (
                  <span className="row small muted hide-sm" style={{ gap: 6 }}>
                    <Stars value={r.average} size={13} /> {r.average.toFixed(1).replace('.', ',')} ({r.total})
                  </span>
                )}
                <button className="icon-btn" aria-label={`Editar ${b.name}`} onClick={() => setEditing(b)}>
                  <Pencil size={17} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <BarberSheet
          barber={editing === 'new' ? null : editing}
          nextSort={barbers.length + 1}
          onClose={() => setEditing(null)}
          onSaved={async (m) => {
            setEditing(null);
            await reload();
            toast(m);
          }}
        />
      )}
    </div>
  );
}

function BarberSheet({ barber, nextSort, onClose, onSaved }: {
  barber: Barber | null;
  nextSort: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(barber?.name ?? '');
  const [bio, setBio] = useState(barber?.bio ?? '');
  const [photo, setPhoto] = useState<string | null>(barber?.photo ?? null);
  const [active, setActive] = useState(barber?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | 'photo' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy('photo');
    try {
      setPhoto(await photoToDataUrl(file));
    } catch {
      toast('Use uma foto em JPG, PNG ou WEBP.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!name.trim()) return setError('Informe o nome.');
    setError(null);
    const row = { name: name.trim(), bio: bio.trim() || null, photo, active };
    setBusy('save');
    const { error: e } = barber
      ? await supabase.from('barbers').update(row).eq('id', barber.id)
      : await supabase.from('barbers').insert({ ...row, sort: nextSort });
    setBusy(null);
    if (e) return toast(errorMessage(e), 'error');
    onSaved(barber ? 'Barbeiro salvo.' : 'Barbeiro cadastrado.');
  }

  async function remove() {
    if (!barber) return;
    const ok = await confirm({
      title: `Apagar ${barber.name}?`,
      text: 'Se ele já tem horários no histórico, o sistema não deixa apagar. Nesse caso, desligue "Aparece na agenda".',
      confirm: 'Apagar',
      danger: true,
    });
    if (!ok) return;
    setBusy('delete');
    const { error: e } = await supabase.from('barbers').delete().eq('id', barber.id);
    setBusy(null);
    if (e) return toast(errorMessage(e), 'error');
    onSaved('Barbeiro apagado.');
  }

  return (
    <Sheet
      title={barber ? 'Editar barbeiro' : 'Novo barbeiro'}
      onClose={onClose}
      footer={
        <>
          {barber && (
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
        <div className="photo-pick">
          <Avatar name={name || '?'} photo={photo} size={76} />
          <div className="stack" style={{ gap: 8 }}>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" className="btn sm outline" onClick={() => fileRef.current?.click()} disabled={busy === 'photo'}>
              {busy === 'photo' ? <Spinner small /> : <Camera size={16} />} {photo ? 'Trocar foto' : 'Colocar foto'}
            </button>
            {photo && (
              <button type="button" className="btn sm ghost" onClick={() => setPhoto(null)}>
                <Trash2 size={16} /> Tirar foto
              </button>
            )}
          </div>
        </div>
        <Field label="Nome" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={error} />
        <Field
          label="Descrição curta (opcional)"
          value={bio}
          maxLength={160}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Ex.: Especialista em degradê e barba"
        />
        <Switch checked={active} onChange={setActive} label="Aparece na agenda e no app" />
      </div>
    </Sheet>
  );
}
