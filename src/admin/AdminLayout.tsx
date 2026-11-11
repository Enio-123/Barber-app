import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  CalendarDays,
  Clock,
  ExternalLink,
  KeyRound,
  LogOut,
  Scissors,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Star,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../state/auth';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { ROLE_LABEL, type Can } from '../lib/roles';
import { Empty, Loading, Notice, Spinner, Wordmark, scriptName } from '../ui/kit';

const NAV: { to: string; end?: boolean; icon: typeof CalendarDays; label: string; show: (c: Can) => boolean }[] = [
  { to: '/admin', end: true, icon: CalendarDays, label: 'Agenda', show: () => true },
  { to: '/admin/clientes', icon: Users, label: 'Clientes', show: (c) => c.clients },
  { to: '/admin/servicos', icon: Scissors, label: 'Serviços', show: (c) => c.catalog },
  { to: '/admin/barbeiros', icon: UserRound, label: 'Barbeiros', show: (c) => c.catalog },
  { to: '/admin/horarios', icon: Clock, label: 'Horários', show: (c) => c.catalog },
  { to: '/admin/avaliacoes', icon: Star, label: 'Avaliações', show: () => true },
  { to: '/admin/ajustes', icon: Settings, label: 'Ajustes', show: (c) => c.catalog },
];

export function AdminLayout() {
  const { session, profileReady, isStaff, aal, role, can, signOut } = useAuth();
  const { shop, reload } = useShop();
  const { toast } = useFeedback();
  const { pathname } = useLocation();
  const open = isStaff && aal === 'aal2';

  // Cada tela do painel abre com os dados mais recentes (outro aparelho pode ter mudado algo).
  useEffect(() => {
    if (open) void reload();
  }, [pathname, open, reload]);

  if (!session) return <Navigate to={`/entrar?voltar=${encodeURIComponent(pathname)}`} replace />;
  if (!profileReady) return <Loading />;
  if (!isStaff) return <NoAccess email={session.user.email ?? ''} />;
  // O banco só libera o painel para sessões verificadas pelo app autenticador.
  if (aal !== 'aal2') return <MfaGate />;

  const name = scriptName(shop?.name ?? 'Easy Cut');
  const links = NAV.filter((n) => n.show(can)).map((n) => (
    <NavLink key={n.to} to={n.to} end={n.end} className="nav-link">
      <n.icon size={18} />
      {n.label}
    </NavLink>
  ));
  const leave = async () => {
    await signOut();
    toast('Você saiu da conta.');
  };

  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="brand">
          <Wordmark sticker name={name} tagline={shop?.tagline ?? ''} />
          <span className="badge accent">Painel · {role ? ROLE_LABEL[role] : ''}</span>
        </div>
        {links}
        <div className="spacer" />
        <Link className="nav-link" to="/">
          <ExternalLink size={18} /> Ver app do cliente
        </Link>
        <button className="nav-link" onClick={leave}>
          <LogOut size={18} /> Sair
        </button>
      </aside>
      <div className="admin-main">
        <div className="admin-mobile-nav">
          <div className="bar">
            <Wordmark sticker size="sm" name={name} tagline={`Painel · ${role ? ROLE_LABEL[role] : ''}`} />
            <Link className="btn sm outline" to="/">
              <ExternalLink size={16} /> App
            </Link>
          </div>
          <nav aria-label="Painel">{links}</nav>
        </div>
        <Outlet />
      </div>
    </div>
  );
}

const CLAIM_ERRORS: Record<string, string> = {
  CODIGO_INVALIDO: errorMessage({ message: 'CODIGO_INVALIDO' }),
  CODIGO_BLOQUEADO: errorMessage({ message: 'CODIGO_BLOQUEADO' }),
  SEM_CODIGO: errorMessage({ message: 'SEM_CODIGO' }),
};

function NoAccess({ email }: { email: string }) {
  const { refreshProfile } = useAuth();
  const { toast } = useFeedback();
  // Primeiro acesso: enquanto ninguém é dono, quem tem o código de primeiro acesso assume o painel.
  const [hasOwner, setHasOwner] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // O dono pode ter liberado esta conta agora há pouco: confere o papel de novo antes de dizer que não tem acesso.
    void refreshProfile();
    supabase.rpc('panel_has_owner').then(({ data, error: err }) => {
      if (alive) setHasOwner(err ? true : Boolean(data));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const claim = async (e: FormEvent) => {
    e.preventDefault();
    if (code.replace(/[^A-Za-z0-9]/g, '').length !== 10) return setError('O código tem 10 letras e números, como ABCDE-23456.');
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.rpc('claim_owner', { p_code: code });
    if (err || data !== 'OK') {
      setBusy(false);
      if (data === 'JA_TEM_DONO') return setHasOwner(true);
      return setError(err ? errorMessage(err) : CLAIM_ERRORS[data as string] ?? errorMessage(null));
    }
    setCode('');
    await refreshProfile();
    toast('Pronto, o painel é seu. Agora cadastre o app autenticador.');
  };

  if (hasOwner === null) return <Loading />;

  return (
    <div className="first-access">
      <Wordmark size="lg" center sticker />
      <div className="card">
        {hasOwner ? (
          <Empty icon={<ShieldAlert size={34} />} title="Sem acesso ao painel">
            <p>
              A conta {email} não faz parte da equipe da barbearia. Peça para o dono liberar seu e-mail em Ajustes, na parte
              Equipe.
            </p>
            <Link className="btn outline" to="/">
              Voltar para o app
            </Link>
          </Empty>
        ) : (
          <Empty icon={<KeyRound size={34} />} title="Primeiro acesso ao painel">
            <p>
              O painel ainda não tem dono. Digite o código de primeiro acesso que você recebeu de quem configurou o sistema. A conta{' '}
              {email} vira a dona do painel.
            </p>
            <form className="form" style={{ width: '100%', maxWidth: 320 }} onSubmit={claim} noValidate>
              <div className="field">
                <label htmlFor="claim-code">Código de primeiro acesso</label>
                <input
                  id="claim-code"
                  className="input code-input"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABCDE-23456"
                  maxLength={14}
                  value={code}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                {error && (
                  <span className="error-text" role="alert">
                    {error}
                  </span>
                )}
              </div>
              <button className="btn primary block" disabled={busy}>
                {busy ? <Spinner small /> : <KeyRound size={18} />} Assumir o painel
              </button>
            </form>
            <Link className="btn outline" to="/">
              Voltar para o app
            </Link>
          </Empty>
        )}
      </div>
    </div>
  );
}

type Prepared =
  | { mode: 'verify'; factorId: string }
  | { mode: 'enroll'; factorId: string; qr: string; secret: string; uri: string }
  | { mode: 'error'; message: string };

/** Verificação em duas etapas: cadastra o app autenticador na primeira vez e pede o código nas outras. */
async function prepareMfa(issuer: string): Promise<Prepared> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { mode: 'error', message: errorMessage(error) };
  const verified = data.totp[0];
  if (verified) return { mode: 'verify', factorId: verified.id };
  // Cadastro que ficou pela metade (QR code gerado e não confirmado): começa de novo.
  for (const f of data.all.filter((x) => x.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
  const stamp = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  const r = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer, friendlyName: `Celular ${stamp}` });
  if (r.error) return { mode: 'error', message: errorMessage(r.error) };
  return { mode: 'enroll', factorId: r.data.id, qr: r.data.totp.qr_code, secret: r.data.totp.secret, uri: r.data.totp.uri };
}

function MfaGate() {
  const { session, signOut } = useAuth();
  const { shop } = useShop();
  const { toast } = useFeedback();
  const [step, setStep] = useState<Prepared | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const job = useRef<Promise<Prepared> | null>(null);
  const issuer = `${shop?.name ?? 'Easy Cut'} · painel`;

  useEffect(() => {
    let alive = true;
    // Uma preparação só, mesmo que a tela monte duas vezes.
    job.current ??= prepareMfa(issuer);
    void job.current.then((p) => alive && setStep(p));
    return () => {
      alive = false;
    };
  }, [issuer]);

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!step || step.mode === 'error') return;
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) return setError('Digite os 6 números que aparecem no app.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: step.factorId, code: digits });
    setBusy(false);
    if (err) {
      setCode('');
      return setError(errorMessage(err));
    }
    toast(step.mode === 'enroll' ? 'App autenticador cadastrado.' : 'Verificado.');
  }

  const retry = () => {
    job.current = prepareMfa(issuer);
    setStep(null);
    void job.current.then(setStep);
  };

  return (
    <div className="first-access">
      <Wordmark size="lg" center sticker />
      <div className="card card-pad stack mfa-card">
        {!step ? (
          <div className="center-fill" style={{ minHeight: 160 }}>
            <Spinner />
          </div>
        ) : step.mode === 'error' ? (
          <Empty icon={<ShieldAlert size={34} />} title="Não foi possível abrir a verificação">
            <p>{step.message}</p>
            <button className="btn outline" onClick={retry}>
              Tentar de novo
            </button>
          </Empty>
        ) : (
          <form className="stack" onSubmit={verify} noValidate>
            <div className="row" style={{ gap: 12 }}>
              <ShieldCheck size={26} />
              <div>
                <h2 style={{ fontSize: 18 }}>{step.mode === 'enroll' ? 'Proteja o painel' : 'Verificação em duas etapas'}</h2>
                <p className="small muted">{session?.user.email}</p>
              </div>
            </div>
            {step.mode === 'enroll' ? (
              <>
                <p className="text-2 small">
                  O painel mostra dados dos clientes, então além da senha ele pede um código do celular. Instale um app autenticador
                  (Google Authenticator, Microsoft Authenticator ou 2FAS), toque em adicionar e escaneie o QR code.
                </p>
                <div className="mfa-qr">
                  <img src={step.qr} alt="QR code para cadastrar o painel no app autenticador" width={184} height={184} />
                </div>
                <details className="small">
                  <summary>Não consegue escanear?</summary>
                  <p className="text-2" style={{ marginTop: 8 }}>
                    No app, escolha digitar a chave e use: <code className="mfa-secret">{step.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                  </p>
                  <p style={{ marginTop: 8 }}>
                    <a className="link-btn" href={step.uri}>
                      <Smartphone size={15} /> Abrir no app autenticador deste celular
                    </a>
                  </p>
                </details>
              </>
            ) : (
              <p className="text-2 small">Abra o app autenticador no seu celular e digite o código de 6 números do painel.</p>
            )}
            <div className="field">
              <label htmlFor="mfa-code">Código do app</label>
              <input
                id="mfa-code"
                className="input code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={7}
                placeholder="123456"
                value={code}
                aria-invalid={error ? true : undefined}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              />
              {error && (
                <span className="error-text" role="alert">
                  {error}
                </span>
              )}
            </div>
            <button className="btn primary block" disabled={busy}>
              {busy ? <Spinner small /> : <ShieldCheck size={18} />} {step.mode === 'enroll' ? 'Confirmar e entrar' : 'Entrar no painel'}
            </button>
            {step.mode === 'verify' && (
              <Notice>Perdeu o celular? Peça para o dono zerar sua verificação em Ajustes, na parte Equipe. Depois você cadastra de novo.</Notice>
            )}
          </form>
        )}
        <div className="row" style={{ justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn sm outline" to="/">
            Voltar para o app
          </Link>
          <button className="btn sm outline" onClick={() => void signOut()}>
            <LogOut size={16} /> Sair
          </button>
        </div>
      </div>
    </div>
  );
}

/** Título de cada tela do painel, com as ações à direita. */
export function AdminTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="admin-top">
      <div>
        <h1>{title}</h1>
        {sub && (
          <p className="muted" style={{ marginTop: 4 }}>
            {sub}
          </p>
        )}
      </div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}
