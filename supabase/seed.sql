-- Dados de EXEMPLO só para testes locais e prints. Não vai para o projeto de verdade:
-- lá o dono cadastra os serviços, preços, barbeiros e horários reais no painel.
update public.shop set
  whatsapp = '5584998567528',
  address = 'Endereço de exemplo, 123 · Centro'
where id = 1;

update public.business_hours set is_open = true, opens = '09:00', closes = '19:00', break_start = '12:00', break_end = '13:00'
where weekday between 1 and 5;
update public.business_hours set is_open = true, opens = '08:00', closes = '16:00' where weekday = 6;

insert into public.services (name, description, duration_minutes, price_cents, sort) values
  ('Corte', 'Máquina e tesoura, com acabamento', 30, 3500, 1),
  ('Barba', 'Toalha quente e navalha', 30, 2500, 2),
  ('Corte e barba', 'Os dois no mesmo horário', 60, 5500, 3),
  ('Pezinho', 'Acabamento do contorno', 15, 1000, 4),
  ('Sobrancelha', 'Na navalha', 15, 1000, 5),
  ('Pigmentação', 'Barba ou cabelo', 30, null, 6);

insert into public.barbers (name, bio, sort) values
  ('Barbeiro 1', 'Exemplo de barbeiro', 1),
  ('Barbeiro 2', 'Exemplo de barbeiro', 2),
  ('Barbeiro 3', 'Exemplo de barbeiro', 3);
