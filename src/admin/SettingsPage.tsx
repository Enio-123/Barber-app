import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, History, KeyRound, Pencil, Share2, ShieldAlert, ShieldCheck, UserMinus, UserPlus } from 'lucide-react';
import { appBaseUrl, supabase } from '../lib/supabase';
import { useAuth } from '../state/auth';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { errorMessage } from '../lib/errors';
import { formatPhone, maskPhone, toWhatsappDigits, validEmail, validPhone } from '../lib/format';
import { dayKeyOf, formatDay, relativeLimit, timeOf } from '../lib/time';
import { ROLE_HINT, ROLE_LABEL, STAFF_ROLES } from '../lib/roles';
import type { AuditEntry, Role, Shop, StaffRole, TeamMember } from '../lib/types';
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
  const { can } = useAuth();
  if (loading || !shop) return <Loading />;
  return (
    <div className="stack lg">
      <AdminTitle
        title="Ajustes"
        sub={can.team ? 'Dados da barbearia, regras da agenda, equipe e histórico de ações.' : 'Dados da barbearia e regras da agenda.'}
      />
      <ShareCard name={shop.name} />
      <ShopForm key={`info-${shop.name}-${shop.whatsapp}-${shop.instagram}-${shop.address}-${shop.maps_url}-${shop.tagline}`} shop={shop} />
      <RulesForm key={`rules-${shop.slot_minutes}-${shop.min_advance_minutes}-${shop.max_days_ahead}-${shop.cancel_limit_minutes}-${shop.max_active_per_client}-${shop.timezone}`} shop={shop} />
      {can.team && <TeamCard />}
      {can.team && <AuditCard tz={shop.timezone} />}
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

function RoleSelect({ id, value, onChange }: { id: string; value: StaffRole; onChange: (r: StaffRole) => void }) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as StaffRole)}>
      {STAFF_ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

function TeamCard() {
  const { session } = useAuth();
  const { barbers } = useShop();
  const { toast, confirm } = useFeedback();
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('reception');
  const [barberId, setBarberId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; role: StaffRole; barberId: string } | null>(null);
  const me = session?.user.id;
  const activeBarbers = barbers.filter((b) => b.active);
  const owners = (team ?? []).filter((m) => m.role === 'owner').length;

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('admin_team');
    if (e) return toast(errorMessage(e), 'error');
    setTeam((data as TeamMember[] | null) ?? []);
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setAccess(target: string, r: Role, barber: string | null, key: string) {
    setBusy(key);
    const { error: e } = await supabase.rpc('admin_set_role', { p_email: target, p_role: r, p_barber_id: r === 'barber' ? barber : null });
    setBusy(null);
    return e;
  }

  async function add() {
    if (!validEmail(email)) return setError('Informe um e-mail válido.');
    if (role === 'barber' && !barberId) return setError('Escolha qual barbeiro é essa pessoa.');
    setError(null);
    const e = await setAccess(email.trim(), role, barberId || null, 'add');
    if (e) return setError(errorMessage(e));
    setEmail('');
    toast(`Acesso liberado como ${ROLE_LABEL[role].toLowerCase()}. No primeiro acesso a pessoa cadastra o app autenticador.`);
    void load();
  }

  async function saveEdit(m: TeamMember) {
    if (!editing) return;
    if (editing.role === 'barber' && !editing.barberId) return toast('Escolha qual barbeiro é essa pessoa.', 'error');
    const e = await setAccess(m.email, editing.role, editing.barberId || null, m.id);
    if (e) return toast(errorMessage(e), 'error');
    setEditing(null);
    toast('Acesso atualizado.');
    if (m.id === me && editing.role !== 'owner') window.location.reload();
    else void load();
  }

  async function remove(m: TeamMember) {
    const self = m.id === me;
    const ok = await confirm({
      title: self ? 'Tirar seu próprio acesso?' : `Tirar o acesso de ${m.full_name || m.email}?`,
      text: self ? 'Você deixa de ver o painel assim que confirmar.' : 'A conta continua existindo como cliente, só sem o painel.',
      confirm: 'Tirar acesso',
      danger: true,
    });
    if (!ok) return;
    const e = await setAccess(m.email, 'client', null, m.id);
    if (e) return toast(errorMessage(e), 'error');
    toast('Acesso removido.');
    if (self) window.location.reload();
    else void load();
  }

  async function resetMfa(m: TeamMember) {
    const ok = await confirm({
      title: `Zerar a verificação de ${m.full_name || m.email}?`,
      text: 'Use quando a pessoa perdeu ou trocou de celular. Ela sai de todos os aparelhos e cadastra o app autenticador de novo no próximo acesso.',
      confirm: 'Zerar verificação',
      danger: true,
    });
    if (!ok) return;
    setBusy(m.id);
    const { error: e } = await supabase.rpc('admin_reset_mfa', { p_user_id: m.id });
    setBusy(null);
    if (e) return toast(errorMessage(e), 'error');
    toast('Verificação zerada.');
    void load();
  }

  const barberName = (id: string | null) => barbers.find((b) => b.id === id)?.name;

  return (
    <section className="card card-pad stack">
      <p className="section-title">Equipe com acesso ao painel</p>
      {team === null ? (
        <div className="skeleton" style={{ height: 56 }} />
      ) : (
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          {team.map((m) => (
            <div key={m.id} className="list-item team-item">
              {m.has_mfa ? <ShieldCheck size={18} className="muted" /> : <ShieldAlert size={18} className="warning-text" />}
              <div className="grow" style={{ minWidth: 0 }}>
                <strong className="ellipsis" style={{ display: 'block' }}>
                  {m.full_name || 'Sem nome'} {m.id === me && <span className="badge accent">Você</span>}
                </strong>
                <span className="small muted ellipsis" style={{ display: 'block' }}>
                  {m.email}
                </span>
                <span className="small" style={{ display: 'block', marginTop: 2 }}>
                  {ROLE_LABEL[m.role]}
                  {m.role === 'barber' && ` · ${barberName(m.barber_id) ?? 'sem barbeiro ligado'}`}
                  {' · '}
                  <span className={m.has_mfa ? 'muted' : 'warning-text'}>
                    {m.has_mfa ? 'verificação em duas etapas ativa' : 'falta cadastrar o app autenticador'}
                  </span>
                </span>
                {editing?.id === m.id && (
                  <div className="form-row" style={{ marginTop: 10 }}>
                    <div className="field">
                      <label htmlFor={`role-${m.id}`}>Papel</label>
                      <RoleSelect id={`role-${m.id}`} value={editing.role} onChange={(r) => setEditing({ ...editing, role: r })} />
                    </div>
                    {editing.role === 'barber' && (
                      <div className="field">
                        <label htmlFor={`barber-${m.id}`}>Qual barbeiro</label>
                        <select
                          id={`barber-${m.id}`}
                          className="select"
                          value={editing.barberId}
                          onChange={(e) => setEditing({ ...editing, barberId: e.target.value })}
                        >
                          <option value="">Escolha</option>
                          {activeBarbers.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="row" style={{ alignItems: 'flex-end', gap: 8 }}>
                      <button className="btn sm primary" disabled={busy !== null} onClick={() => saveEdit(m)}>
                        {busy === m.id && <Spinner small />} Salvar
                      </button>
                      <button className="btn sm outline" onClick={() => setEditing(null)}>
                        Voltar
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <span className="row" style={{ gap: 2 }}>
                <button
                  className="icon-btn"
                  aria-label={`Mudar o papel de ${m.email}`}
                  disabled={busy !== null || (m.role === 'owner' && owners < 2)}
                  onClick={() => setEditing({ id: m.id, role: m.role, barberId: m.barber_id ?? '' })}
                >
                  <Pencil size={16} />
                </button>
                {m.id !== me && (
                  <button
                    className="icon-btn"
                    aria-label={`Zerar a verificação em duas etapas de ${m.email}`}
                    disabled={busy !== null || !m.has_mfa}
                    onClick={() => resetMfa(m)}
                  >
                    <KeyRound size={16} />
                  </button>
                )}
                <button
                  className="icon-btn"
                  aria-label={`Tirar acesso de ${m.email}`}
                  disabled={busy !== null || (m.role === 'owner' && owners < 2)}
                  onClick={() => remove(m)}
                >
                  {busy === m.id && !editing ? <Spinner small /> : <UserMinus size={17} />}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <Notice>
        A pessoa cria a conta no app primeiro (Perfil, Criar conta). Depois você libera pelo e-mail que ela usou e escolhe o papel. No
        primeiro acesso ao painel ela cadastra um app autenticador no celular.
      </Notice>
      <div className="form">
        <div className="form-row">
          <Field
            label="E-mail da pessoa"
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
          <div className="field">
            <label htmlFor="team-role">Papel</label>
            <RoleSelect id="team-role" value={role} onChange={setRole} />
            <span className="hint">{ROLE_HINT[role]}</span>
          </div>
        </div>
        {role === 'barber' && (
          <div className="field">
            <label htmlFor="team-barber">Qual barbeiro é essa pessoa</label>
            <select id="team-barber" className="select" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
              <option value="">Escolha</option>
              {activeBarbers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="hint">Ela vê só a agenda e as avaliações desse barbeiro.</span>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn outline" disabled={busy !== null} onClick={add}>
            {busy === 'add' ? <Spinner small /> : <UserPlus size={17} />} Dar acesso
          </button>
        </div>
      </div>
    </section>
  );
}

const FIELD: Record<string, string> = {
  name: 'nome',
  description: 'descrição',
  duration_minutes: 'duração',
  price_cents: 'preço',
  active: 'ativo',
  sort: 'ordem',
  bio: 'apresentação',
  photo: 'foto',
  is_open: 'aberto ou fechado',
  opens: 'abre',
  closes: 'fecha',
  break_start: 'início do intervalo',
  break_end: 'fim do intervalo',
  tagline: 'frase',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  address: 'endereço',
  maps_url: 'link do Maps',
  timezone: 'fuso horário',
  slot_minutes: 'intervalo dos horários',
  min_advance_minutes: 'antecedência mínima',
  max_days_ahead: 'dias abertos na agenda',
  cancel_limit_minutes: 'prazo para cancelar',
  max_active_per_client: 'horários por cliente',
};
const STATUS_LABEL: Record<string, string> = {
  confirmed: 'confirmado',
  completed: 'concluído',
  cancelled: 'cancelado',
  no_show: 'não compareceu',
};
const ENTITY: Record<string, [string, string, string]> = {
  services: ['criou o serviço', 'alterou o serviço', 'apagou o serviço'],
  barbers: ['cadastrou o barbeiro', 'alterou o barbeiro', 'apagou o barbeiro'],
};

/** Frase curta do que aconteceu, a partir do registro do histórico. */
function describe(e: AuditEntry): string {
  const d = (e.details ?? {}) as Record<string, { de?: unknown; para?: unknown } | unknown>;
  const changed = Object.keys(d)
    .map((k) => FIELD[k])
    .filter(Boolean);
  const fields = e.action === 'update' && changed.length ? ` (${changed.join(', ')})` : '';
  const t = e.target ?? '';
  if (ENTITY[e.entity]) {
    const [ins, upd, del] = ENTITY[e.entity];
    return `${e.action === 'insert' ? ins : e.action === 'delete' ? del : upd} ${t}${fields}`.trim();
  }
  switch (e.entity) {
    case 'business_hours':
      return `mudou o horário de ${t.toLowerCase() || 'um dia'}${fields}`;
    case 'shop':
      return `alterou os dados da barbearia${fields}`;
    case 'reviews':
      return 'apagou uma avaliação';
    case 'appointments': {
      const kind = (d.kind as string | undefined) ?? '';
      const place = t ? `: ${t}` : '';
      if (e.action === 'insert') return `${kind === 'block' ? 'bloqueou a agenda' : 'marcou um horário'}${place}`;
      if (e.action === 'delete') return `${kind === 'block' ? 'removeu um bloqueio' : 'apagou um horário'}${place}`;
      const st = d.status as { para?: string } | undefined;
      if (st?.para) return `mudou a situação para ${STATUS_LABEL[st.para] ?? st.para}${place}`;
      if (d.starts_at || d.barber_id) return `remarcou${place}`;
      return `alterou um horário${place}`;
    }
    case 'profiles': {
      if (e.action === 'mudou o acesso') {
        const de = ROLE_LABEL[d.de as Role] ?? String(d.de ?? '');
        const para = ROLE_LABEL[d.para as Role] ?? String(d.para ?? '');
        return `mudou o acesso de ${t || 'uma conta'}: ${de} para ${para}`;
      }
      if (e.action === 'zerou a verificação em duas etapas') return `zerou a verificação em duas etapas de ${t || 'uma conta'}`;
      return e.action;
    }
    default:
      return `${e.action} ${e.entity}`;
  }
}

/** Histórico das ações da equipe: ninguém apaga nem altera, e só o dono vê. */
function AuditCard({ tz }: { tz: string }) {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    let alive = true;
    supabase.rpc('admin_audit_log', { p_limit: limit }).then(({ data, error }) => {
      if (!alive) return;
      setFailed(Boolean(error));
      setRows((data as AuditEntry[] | null) ?? []);
    });
    return () => {
      alive = false;
    };
  }, [limit]);

  return (
    <section className="card card-pad stack">
      <div className="row" style={{ gap: 10 }}>
        <History size={18} />
        <p className="section-title" style={{ margin: 0 }}>
          Histórico de ações da equipe
        </p>
      </div>
      <p className="text-2 small">
        Tudo o que a equipe muda no painel fica registrado aqui: quem, quando e o quê. Ninguém consegue apagar ou editar esse
        histórico. Dados de clientes (nome e telefone) não ficam guardados nele.
      </p>
      {failed && <Notice tone="danger">Não foi possível carregar o histórico agora.</Notice>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} />
      ) : rows.length === 0 ? (
        <p className="muted small">Nenhuma ação registrada ainda.</p>
      ) : (
        <ol className="audit-list">
          {rows.map((r, i) => (
            <li key={`${r.at}-${i}`}>
              <span className="audit-when small muted">
                {formatDay(dayKeyOf(r.at, tz), 'short')} {timeOf(r.at, tz)}
              </span>
              <span className="small">
                <strong>{r.actor_name}</strong>
                {r.actor_role && ROLE_LABEL[r.actor_role as Role] ? ` (${ROLE_LABEL[r.actor_role as Role].toLowerCase()})` : ''} {describe(r)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {rows && rows.length >= limit && limit < 500 && (
        <button className="btn sm outline" onClick={() => setLimit((l) => Math.min(500, l + 100))}>
          Ver mais
        </button>
      )}
    </section>
  );
}
