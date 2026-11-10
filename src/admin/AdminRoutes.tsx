import { Navigate, Route, Routes } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { AgendaPage } from './AgendaPage';
import { ClientsPage } from './ClientsPage';
import { ServicesPage } from './ServicesPage';
import { BarbersPage } from './BarbersPage';
import { HoursPage } from './HoursPage';
import { ReviewsPage } from './ReviewsPage';
import { SettingsPage } from './SettingsPage';

export default function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AgendaPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="servicos" element={<ServicesPage />} />
        <Route path="barbeiros" element={<BarbersPage />} />
        <Route path="horarios" element={<HoursPage />} />
        <Route path="avaliacoes" element={<ReviewsPage />} />
        <Route path="ajustes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}
