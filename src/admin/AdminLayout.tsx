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
  Star,
  UserRound,
  Users,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../state/auth';
import { useShop } from '../state/shop';
import { useFeedback } from '../state/feedback';
import { supabase } from '../lib/supabase';
import { errorMessage } from '../lib/errors';
import { Empty, Loading, Spinner, Wordmark, scriptName } from '../ui/kit';

const NAV = [
  { to: '/admin', end: true, icon: CalendarDays, label: 'Agenda' },
  { to: '/admin/clientes', icon: Users, label: 'Clientes' },
  { to: '/admin/servicos', icon: Scissors, label: 'Serviços' },
  { to: '/admin/barbeiros', icon: UserRound, label: 'Barbeiros' },
  { to: '/admin/horarios', icon: Clock, label: 'Horários' },
  { to: '/admin/avaliacoes', icon: Star, label: 'Avaliações' },
  { to: '/admin/ajustes', icon: Settings, label: 'Ajustes' },
];

export function AdminLayout() {
  const { session, profileReady, isAdmin, signOut } = useAuth();
  const { shop, reload } = useShop();
  const { toast } = useFeedback();
  const { pathname } = useLocation();

  // Cada tela do painel abre com os dados mais recentes (outro aparelho pode ter mudado algo).
  useEffect(() => {
    if (isAdmin) void reload();
  }, [pathname, isAdmin, reload]);

  if (!session) return <Navigate to={`/entrar?voltar=${encodeURIComponent(pathname)}`} replace />;
  if (!profileReady) return <Loading />;
  if (!isAdmin) return <NoAccess email={session.user.email ?? ''} />;

  const name = scriptName(shop?.name ?? 'Easy Cut');
  const links = NAV.map((n) => (
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
          <span className="badge accent">Painel da barbearia</span>
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
            <Wordmark sticker size="sm" name={name} tagline="Painel da barbearia" />
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

function NoAccess({ email }: { email: string }) {
  const { refreshProfile } = useAuth();
  const { toast } = useFeedback();
  // Primeiro acesso: enquanto ninguém é dono, a própria conta pode assumir o painel.
  const [hasOwner, setHasOwner] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.rpc('panel_has_owner').then(({ data, error: err }) => {
      if (alive) setHasOwner(err ? true : Boolean(data));
    });
    return () => {
      alive = false;
    };
  }, []);

  const claim = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('claim_owner');
    if (err) {
      setError(errorMessage(err));
      setBusy(false);
      if (err.message.includes('JA_TEM_DONO')) setHasOwner(true);
      return;
    }
    await refreshProfile();
    toast('Pronto, o painel é seu.');
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
              O painel ainda não tem dono. Se você é o responsável pela barbearia, assuma com a conta {email}. Depois você libera
              o resto da equipe em Ajustes.
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <button className="btn primary" onClick={claim} disabled={busy}>
              {busy ? <Spinner small /> : <KeyRound size={18} />} Sou o dono, assumir o painel
            </button>
            <Link className="btn outline" to="/">
              Voltar para o app
            </Link>
          </Empty>
        )}
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
