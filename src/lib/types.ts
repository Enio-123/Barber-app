export type Shop = {
  id: number;
  name: string;
  tagline: string;
  whatsapp: string | null;
  instagram: string | null;
  address: string | null;
  maps_url: string | null;
  timezone: string;
  slot_minutes: number;
  min_advance_minutes: number;
  max_days_ahead: number;
  cancel_limit_minutes: number;
  max_active_per_client: number;
};

export type Service = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number | null;
  active: boolean;
  sort: number;
};

export type Barber = {
  id: string;
  name: string;
  bio: string | null;
  photo: string | null;
  active: boolean;
  sort: number;
};

export type Hours = {
  weekday: number;
  is_open: boolean;
  opens: string | null;
  closes: string | null;
  break_start: string | null;
  break_end: string | null;
};

export type Rating = { barber_id: string; average: number; total: number };

/** Papéis: cliente e, na equipe, barbeiro (só a própria agenda), recepção (agenda de todos e clientes),
 *  gerente (mais o cadastro da barbearia) e dono (mais equipe e histórico). */
export type Role = 'client' | 'barber' | 'reception' | 'manager' | 'owner';
export type StaffRole = Exclude<Role, 'client'>;

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  role: Role;
  barber_id: string | null;
  terms_version: string | null;
  terms_accepted_at: string | null;
};

export type Status = 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export type AppointmentItem = { service_id?: string; name: string; duration_minutes: number; price_cents: number | null };

export type Appointment = {
  id: string;
  kind: 'booking' | 'block';
  barber_id: string;
  client_id: string | null;
  client_name: string | null;
  client_phone: string | null;
  starts_at: string;
  ends_at: string;
  status: Status;
  total_cents: number | null;
  note: string | null;
  source: 'app' | 'admin';
  created_at: string;
  cancelled_at?: string | null;
  cancelled_by?: 'client' | 'admin' | null;
  barber?: { id: string; name: string; photo: string | null } | null;
  items?: AppointmentItem[];
  review?: { rating: number; comment: string | null } | { rating: number; comment: string | null }[] | null;
};

export type AdminClient = {
  client_id: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
  bookings: number;
  completed: number;
  no_shows: number;
  last_visit: string | null;
  next_visit: string | null;
};

export type AdminReview = {
  appointment_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  barber_id: string;
  appointment: { starts_at: string; client_name: string | null } | null;
};

export type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  barber_id: string | null;
  has_mfa: boolean;
};

export type AuditEntry = {
  at: string;
  actor_name: string;
  actor_role: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  target: string | null;
  details: Record<string, unknown> | null;
};
