-- Volta o banco LOCAL ao estado inicial com os dados de exemplo (só para testes).
delete from public.reviews;
delete from public.appointment_services;
delete from public.appointments;
delete from public.services;
delete from public.barbers;
delete from auth.users where email like '%@teste.local';
update public.business_hours set is_open = false, opens = null, closes = null, break_start = null, break_end = null;
update public.shop set name = 'Easy Cut', tagline = 'Studio & Barber Shop', whatsapp = null, instagram = null,
  address = null, maps_url = null, timezone = 'America/Fortaleza', slot_minutes = 30, min_advance_minutes = 30,
  max_days_ahead = 30, cancel_limit_minutes = 120, max_active_per_client = 2
where id = 1;
-- Ninguém é dono: o primeiro acesso ao painel volta a aparecer.
update public.profiles set role = 'client';
