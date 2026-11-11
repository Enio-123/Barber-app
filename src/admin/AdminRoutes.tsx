import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../state/auth';
import type { Can } from '../lib/roles';
import { AdminLayout } from './AdminLayout';
import { AgendaPage } from './AgendaPage';
import { ClientsPage } from './ClientsPage';
import { ServicesPage } from './ServicesPage';
import { BarbersPage } from './BarbersPage';
import { HoursPage } from './HoursPage';
import { ReviewsPage } from './ReviewsPage';
import { SettingsPage } from './SettingsPage';

/** Tela só para quem tem o papel certo (o banco também recusa, isto só evita a tela vazia). */
function Only({ allow, children }: { allow: keyof Can; children: ReactNode }) {
  const { can } = useAuth();
  return can[allow] ? children : <Navigate to="/admin" replace />;
}

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AgendaPage />} />
        <Route path="clientes" element={<Only allow="clients"><ClientsPage /></Only>} />
        <Route path="servicos" element={<Only allow="catalog"><ServicesPage /></Only>} />
        <Route path="barbeiros" element={<Only allow="catalog"><BarbersPage /></Only>} />
        <Route path="horarios" element={<Only allow="catalog"><HoursPage /></Only>} />
        <Route path="avaliacoes" element={<ReviewsPage />} />
        <Route path="ajustes" element={<Only allow="catalog"><SettingsPage /></Only>} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
