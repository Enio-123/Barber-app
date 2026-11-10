import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, Share2, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { appBaseUrl, supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { formatPhone, maskPhone, toWhatsappDigits, validEmail, validPhone } from '../lib/format';
import { relativeLimit } from '../lib/time';
import type { AdminUser, Shop } from '../lib/types';
import { Field, Loading, Notice, Spinner } from '../ui/kit';
import { AdminTitle } from './AdminLayout';

const TIMEZONES: [string, string][] = [
  ['America/Fortaleza', 'RN, CE, PB, PI e MA'],
  ['America/Recife', 'Pernambuco'],
  ['America/Maceio', 'Alagoas e Sergipe'],
  ['America/Bahia', 'Bahia'],
  ['America/Belem', 'Pará (leste) e Amapá'],
  ['America/Araguaina', 'Tocantins'],
  ['America/Sao_Paulo', 'Sul, Sudeste, Goiás e DF'],
  ['America/Campo_Grande', 'Mato Grosso do Sul'],
  ['America/Cuiaba', 'Mato Grosso'],
  ['America/Manaus', 'Amazonas'],
  ['America/Porto_Velho', 'Rondônia'],
  ['America/Boa_Vista', 'Roraima'],
  ['America/Rio_Branco', 'Acre'],
  ['America/Noronha', 'Fernando de Noronha'],
];

const SLOTS = [10, 15, 20, 30, 45, 60];
const ADVANCE = [0, 15, 30, 60, 120, 180, 240, 720, 1440];
const DAYS_AHEAD = [7, 14, 21, 30, 45, 60, 90];
const CANCEL = [0, 30, 60, 120, 180, 360, 720, 1440];

/** "@easycut", "easycut" ou o link do perfil -> "easycut". */
function instagramHandle(v: string) {
  const t = v.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return t;
}

export function SettingsPage() {
  const { shop, loading } = useShop();
  if (loading || !shop) return <Loading />;
  return (
    <div className="stack lg">
      <AdminTitle title="Ajustes" sub="Dados da barbearia, regras da agenda e quem tem acesso ao painel." />
      <ShareCard name={shop.name} />
      <ShopForm key={`info-${shop.name}-${shop.whatsapp}-${shop.instagram}-${shop.address}-${shop.maps_url}-${shop.tagline}`} shop={shop} />
      <RulesForm key={`rules-${shop.slot_minutes}-${shop.min_advance_minutes}-${shop.max_days_ahead}-${shop.cancel_limit_minutes}-${shop.max_active_per_client}-${shop.timezone}`} shop={shop} />
      <TeamCard />
    </div>
  );
}

function ShareCard({ name }: { name: string }) {
  const { toast } = useFeedback();
  const canvas = useRef<HTMLCanvasElement>(null);
  const url = appBaseUrl();

  useEffect(() => {
    let alive = true;
    import('qrcode').then((QR) => {
      if (alive && canvas.current) {
        void QR.toCanvas(canvas.current, url, { width: 176, margin: 1, color: { dark: '#0b0c0e', light: '#ffffff' } });
      }
    });
    return () => {
      alive = false;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado.');
    } catch {
      toast('Não deu para copiar. Segure o link para copiar.', 'error');
    }
  }

  async function downloadQr() {
    const QR = await import('qrcode');
    const data = await QR.toDataURL(url, { width: 1024, margin: 2, color: { dark: '#0b0c0e', light: '#ffffff' } });
    const a = document.createElement('a');
    a.href = data;
    a.download = 'qr-code-agendamento.png';
    a.click();
  }

  const share = typeof navigator.share === 'function';

  return (
    <section className="card card-pad share-card">
      <div className="stack" style={{ gap: 10 }}>
        <p className="section-title">Link de agendamento</p>
        <p className="text-2 small">Coloque na bio do Instagram, mande no WhatsApp e imprima o QR code para o balcão.</p>
        <div className="share-url ellipsis">{url}</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn sm outline" onClick={copy}>
            <Copy size={16} /> Copiar link
          </button>
          {share && (
            <button className="btn sm outline" onClick={() => navigator.share({ title: name, text: `Agende seu horário na ${name}`, url }).catch(() => undefined)}>
              <Share2 size={16} /> Compartilhar
            </button>
          )}
          <button className="btn sm outline" onClick={downloadQr}>
            <Download size={16} /> Baixar QR code
          </button>
        </div>
      </div>
      <canvas ref={canvas} className="qr" width={176} height={176} aria-label="QR code do link de agendamento" />
    </section>
  );
}

function ShopForm({ shop }: { shop: Shop }) {
  const { reload } = useShop();
  const { toast } = useFeedback();
  const [name, setName] = useState(shop.name);
  const [tagline, setTagline] = useState(shop.tagline);
  const [whatsapp, setWhatsapp] = useState(formatPhone(shop.whatsapp));
  const [instagram, setInstagram] = useState(shop.instagram ? `@${shop.instagram}` : '');
  const [address, setAddress] = useState(shop.address ?? '');
  const [maps, setMaps] = useState(shop.maps_url ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function save() {
    const errs: Record<string, string> = {};
    const ig = instagramHandle(instagram);
    if (!name.trim()) errs.name = 'Informe o nome.';
    if (whatsapp && !validPhone(whatsapp)) errs.whatsapp = 'WhatsApp com DDD, por exemplo (84) 99856-7528.';
    if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) errs.instagram = 'Use só o @ do perfil, por exemplo @easycut.';
    if (maps.trim() && !/^https:\/\//.test(maps.trim())) errs.maps = 'Cole o link completo, começando com https://';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setSaving(true);
    const { error } = await supabase
      .from('shop')
      .update({
        name: name.trim(),
        tagline: tagline.trim(),
        whatsapp: whatsapp ? toWhatsappDigits(whatsapp) : null,
        instagram: ig || null,
        address: address.trim() || null,
        maps_url: maps.trim() || null,
      })
      .eq('id', 1);
    setSaving(false);
    if (error) return toast(errorMessage(error), 'error');
    await reload();
    toast('Dados da barbearia salvos.');
  }

  return (
    <section className="card card-pad stack">
      <p className="section-title">Dados da barbearia</p>
      <div className="form">
        <div className="form-row">
          <Field label="Nome" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={errors.name} />
          <Field label="Frase embaixo do nome" value={tagline} maxLength={80} onChange={(e) => setTagline(e.target.value)} />
        </div>
        <div className="form-row">
          <Field
            label="WhatsApp da barbearia"
            type="tel"
            inputMode="tel"
            placeholder="(84) 99999-9999"
            value={whatsapp}
            onChange={(e) => setWhatsapp(maskPhone(e.target.value))}
            error={errors.whatsapp}
          />
          <Field label="Instagram" placeholder="@perfil" value={instagram} onChange={(e) => setInstagram(e.target.value)} error={errors.instagram} />
        </div>
        <Field label="Endereço" maxLength={200} placeholder="Rua, número, bairro, cidade" value={address} onChange={(e) => setAddress(e.target.value)} />
        <Field
          label="Link do Google Maps"
          placeholder="https://maps.app.goo.gl/..."
          value={maps}
          onChange={(e) => setMaps(e.target.value)}
          error={errors.maps}
          hint="No Google Maps, abra a barbearia, toque em Compartilhar e copie o link."
        />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving && <Spinner small />} Salvar dados
          </button>
        </div>
      </div>
    </section>
  );
}

function Select({ id, label, value, options, onChange, hint, format }: {
  id: string;
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  hint?: string;
  format: (v: number) => string;
}) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {all.map((o) => (
          <option key={o} value={o}>
            {format(o)}
          </option>
        ))}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function RulesForm({ shop }: { shop: Shop }) {
  const { reload } = useShop();
  const { toast } = useFeedback();
  const [slot, setSlot] = useState(shop.slot_minutes);
  const [advance, setAdvance] = useState(shop.min_advance_minutes);
  const [ahead, setAhead] = useState(shop.max_days_ahead);
  const [cancel, setCancel] = useState(shop.cancel_limit_minutes);
  const [perClient, setPerClient] = useState(shop.max_active_per_client);
  const [timezone, setTimezone] = useState(shop.timezone);
  const [saving, setSaving] = useState(false);
  const zones = TIMEZONES.some(([z]) => z === timezone) ? TIMEZONES : [...TIMEZONES, [timezone, timezone] as [string, string]];

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from('shop')
      .update({
        slot_minutes: slot,
        min_advance_minutes: advance,
        max_days_ahead: ahead,
        cancel_limit_minutes: cancel,
        max_active_per_client: perClient,
        timezone,
      })
      .eq('id', 1);
    setSaving(false);
    if (error) return toast(errorMessage(error), 'error');
    await reload();
    toast('Regras da agenda salvas.');
  }

  return (
    <section className="card card-pad stack">
      <p className="section-title">Regras da agenda</p>
      <div className="form">
        <div className="form-row">
          <Select
            id="r-slot"
            label="Horários de quanto em quanto tempo"
            value={slot}
            options={SLOTS}
            onChange={setSlot}
            format={(v) => `A cada ${v} min`}
            hint="Ex.: a cada 30 min mostra 09:00, 09:30, 10:00..."
          />
          <Select
            id="r-adv"
            label="Antecedência mínima"
            value={advance}
            options={ADVANCE}
            onChange={setAdvance}
            format={(v) => (v === 0 ? 'Sem mínimo' : relativeLimit(v))}
            hint="Evita cliente marcando em cima da hora."
          />
        </div>
        <div className="form-row">
          <Select id="r-ahead" label="Agenda aberta para os próximos" value={ahead} options={DAYS_AHEAD} onChange={setAhead} format={(v) => `${v} dias`} />
          <Select
            id="r-cancel"
            label="Cliente cancela pelo app até"
            value={cancel}
            options={CANCEL}
            onChange={setCancel}
            format={(v) => (v === 0 ? 'Até a hora do horário' : `${relativeLimit(v)} antes`)}
            hint="Depois disso, o app pede para falar no WhatsApp."
          />
        </div>
        <div className="form-row">
          <Select
            id="r-max"
            label="Horários marcados ao mesmo tempo por cliente"
            value={perClient}
            options={[1, 2, 3, 4, 5]}
            onChange={setPerClient}
            format={(v) => (v === 1 ? '1 horário' : `${v} horários`)}
          />
          <div className="field">
            <label htmlFor="r-tz">Fuso horário</label>
            <select id="r-tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map(([z, label]) => (
                <option key={z} value={z}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" disabled={saving} onClick={save}>
            {saving && <Spinner small />} Salvar regras
          </button>
        </div>
      </div>
    </section>
  );
}

function TeamCard() {
  const { session } = useAuth();
  const { toast, confirm } = useFeedback();
  const [admins, setAdmins] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('admin_list_admins');
    setAdmins((data as AdminUser[] | null) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!validEmail(email)) return setError('Informe um e-mail válido.');
    setError(null);
    setBusy('add');
    const { error: e } = await supabase.rpc('admin_set_role', { p_email: email.trim(), p_role: 'admin' });
    setBusy(null);
    if (e) return setError(errorMessage(e));
    setEmail('');
    toast('Acesso ao painel liberado.');
    void load();
  }

  async function remove(a: AdminUser) {
    const self = a.id === session?.user.id;
    const ok = await confirm({
      title: self ? 'Tirar seu próprio acesso?' : `Tirar o acesso de ${a.full_name || a.email}?`,
      text: self ? 'Você deixa de ver o painel assim que confirmar.' : 'A conta continua existindo como cliente, só sem o painel.',
      confirm: 'Tirar acesso',
      danger: true,
    });
    if (!ok) return;
    setBusy(a.id);
    const { error: e } = await supabase.rpc('admin_set_role', { p_email: a.email, p_role: 'client' });
    setBusy(null);
    if (e) return toast(errorMessage(e), 'error');
    toast('Acesso removido.');
    if (self) window.location.reload();
    else void load();
  }

  return (
    <section className="card card-pad stack">
      <p className="section-title">Equipe com acesso ao painel</p>
      {admins === null ? (
        <div className="skeleton" style={{ height: 56 }} />
      ) : (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          {admins.map((a) => (
            <div key={a.id} className="list-item">
              <ShieldCheck size={18} className="muted" />
              <span className="grow">
                <strong className="ellipsis" style={{ display: 'block' }}>
                  {a.full_name || 'Sem nome'} {a.id === session?.user.id && <span className="badge accent">Você</span>}
                </strong>
                <span className="small muted ellipsis" style={{ display: 'block' }}>
                  {a.email}
                </span>
              </span>
              <button className="icon-btn" aria-label={`Tirar acesso de ${a.email}`} disabled={busy !== null || admins.length < 2} onClick={() => remove(a)}>
                {busy === a.id ? <Spinner small /> : <UserMinus size={17} />}
              </button>
            </div>
          ))}
        </div>
      )}
      <Notice>A pessoa cria a conta no app primeiro (Perfil, Criar conta). Depois você libera pelo e-mail que ela usou.</Notice>
      <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="grow" style={{ minWidth: 220 }}>
          <Field
            label="E-mail da pessoa"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
        </div>
        <button className="btn outline" style={{ marginTop: 24 }} disabled={busy !== null} onClick={add}>
          {busy === 'add' ? <Spinner small /> : <UserPlus size={17} />} Dar acesso
        </button>
      </div>
    </section>
  );
}
