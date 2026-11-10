import { NavLink, Outlet, Link } from 'react-router-dom';
import { CalendarPlus, History, Store, UserRound, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../state/auth';
import { useShop } from '../state/shop';
import { Wordmark, scriptName } from '../ui/kit';

export function ClientLayout() {
  const { session, isAdmin } = useAuth();
  const { shop } = useShop();
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" aria-label="Início">
          <Wordmark sticker size="sm" name={scriptName(shop?.name ?? 'Easy Cut')} tagline={shop?.tagline ?? 'Studio & Barber Shop'} />
        </Link>
        {isAdmin ? (
          <Link className="btn sm outline" to="/admin">
            <LayoutDashboard size={16} /> Painel
          </Link>
        ) : !session ? (
          <Link className="btn sm outline" to="/entrar">
            Entrar
          </Link>
        ) : null}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label="Navegação">
        <NavLink to="/" end>
          <CalendarPlus size={22} />
          Agendar
        </NavLink>
        <NavLink to="/historico">
          <History size={22} />
          Meus horários
        </NavLink>
        <NavLink to="/barbearia">
          <Store size={22} />
          Barbearia
        </NavLink>
        <NavLink to="/perfil">
          <UserRound size={22} />
          Perfil
        </NavLink>
      </nav>
    </div>
  );
}
