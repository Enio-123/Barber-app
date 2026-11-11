import type { Role, StaffRole } from './types';

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  reception: 'Recepção',
  barber: 'Barbeiro',
  client: 'Cliente',
};

export const STAFF_ROLES: StaffRole[] = ['owner', 'manager', 'reception', 'barber'];

export const ROLE_HINT: Record<StaffRole, string> = {
  owner: 'Tudo, inclusive a equipe e o histórico de ações.',
  manager: 'Agenda, clientes, serviços, barbeiros, horários, avaliações e ajustes. Não mexe na equipe.',
  reception: 'Agenda de todos os barbeiros e lista de clientes. Não mexe em preços, horários nem ajustes.',
  barber: 'Só a própria agenda e as próprias avaliações.',
};

/** O que cada papel vê no painel. É só para a tela: quem decide de verdade é o banco. */
export type Can = {
  agendaAll: boolean;
  clients: boolean;
  exportClients: boolean;
  catalog: boolean;
  reviewsDelete: boolean;
  team: boolean;
};

export function permissions(role: Role | null | undefined): Can {
  const desk = role === 'owner' || role === 'manager' || role === 'reception';
  const admin = role === 'owner' || role === 'manager';
  return { agendaAll: desk, clients: desk, exportClients: admin, catalog: admin, reviewsDelete: admin, team: role === 'owner' };
}
