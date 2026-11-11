import { lazy, Suspense, useEffect, useRef } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { configured, emailLinkProblem } from './lib/supabase';
import { AuthProvider, useAuth } from './state/auth';
import { ShopProvider } from './state/shop';
import { FeedbackProvider, useFeedback } from './state/feedback';
import { Loading, Spinner, Wordmark } from './ui/kit';
import { ClientLayout } from './client/ClientLayout';
import { BookPage } from './client/BookPage';
import { HistoryPage } from './client/HistoryPage';
import { ShopPage } from './client/ShopPage';
import { ProfilePage } from './client/ProfilePage';
import { AuthPage } from './client/AuthPage';
import { ResetPasswordPage } from './client/ResetPasswordPage';
import { BookedPage } from './client/BookedPage';
import { PrivacyPage, TermsPage } from './client/LegalPages';

// O painel só é baixado por quem abre o painel: o app do cliente fica leve no 4G.
const AdminRoutes = lazy(() => import('./admin/AdminRoutes'));

export function App() {
  if (!configured) return <SetupNeeded />;
  return (
    <AuthProvider>
      <ShopProvider>
        <FeedbackProvider>
          <Gate />
        </FeedbackProvider>
      </ShopProvider>
    </AuthProvider>
  );
}

function Gate() {
  const { ready } = useAuth();
  // Espera o login (inclusive o que vem do link do e-mail) antes de montar as rotas.
  if (!ready) return <Splash />;
  return (
    <HashRouter>
      <AuthLinks />
      <Routes>
        <Route element={<ClientLayout />}>
          <Route index element={<BookPage />} />
          <Route path="historico" element={<HistoryPage />} />
          <Route path="barbearia" element={<ShopPage />} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="entrar" element={<AuthPage />} />
          <Route path="redefinir-senha" element={<ResetPasswordPage />} />
          <Route path="agendado/:id" element={<BookedPage />} />
          <Route path="privacidade" element={<PrivacyPage />} />
          <Route path="termos" element={<TermsPage />} />
        </Route>
        <Route
          path="admin/*"
          element={
            <Suspense fallback={<Loading />}>
              <AdminRoutes />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

/** Leva para "Criar nova senha" quando a pessoa abre o link de recuperação. */
function AuthLinks() {
  const { recovering } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const sent = useRef(false);

  useEffect(() => {
    if (recovering && !sent.current) {
      sent.current = true;
      if (pathname !== '/redefinir-senha') navigate('/redefinir-senha', { replace: true });
    }
    if (!recovering) sent.current = false;
  }, [recovering, pathname, navigate]);

  useEffect(() => {
    const problem = emailLinkProblem();
    if (problem) toast(problem, 'error');
  }, [toast]);

  return null;
}

function Splash() {
  return (
    <div className="center-fill" style={{ minHeight: '100dvh', gap: 28 }}>
      <Wordmark size="lg" center sticker />
      <Spinner />
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="setup-needed card stack">
      <Wordmark center />
      <h1 style={{ fontSize: 20 }}>Falta conectar o banco de dados</h1>
      <p className="text-2">
        Este app precisa do endereço e da chave pública do projeto Supabase da barbearia. Coloque os dois no arquivo{' '}
        <code>.env.production</code> (<code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>) e publique de novo.
      </p>
      <p className="muted small">O passo a passo completo está no arquivo LEIA-ME.md do projeto.</p>
    </div>
  );
}
