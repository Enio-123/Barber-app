import { supabase } from '../lib/supabase';
import { addDays, dayKeyOf, zonedToDate, type DayKey } from '../lib/time';
import type { Appointment } from '../lib/types';
import { APPT_SELECT } from '../client/HistoryPage';

/** Agendamentos e bloqueios que tocam o dia (no fuso da barbearia). */
export async function fetchDay(day: DayKey, tz: string, barberId?: string) {
  const from = zonedToDate(day, '00:00', tz).toISOString();
  const to = zonedToDate(addDays(day, 1), '00:00', tz).toISOString();
  let q = supabase.from('appointments').select(APPT_SELECT).lt('starts_at', to).gt('ends_at', from).order('starts_at');
  if (barberId) q = q.eq('barber_id', barberId);
  const { data, error } = await q;
  return { data: ((data as unknown as Appointment[] | null) ?? []), error };
}

/** Quantos clientes marcados em cada dia da semana que começa em `start`. */
export async function fetchWeekCounts(start: DayKey, tz: string) {
  const from = zonedToDate(start, '00:00', tz).toISOString();
  const to = zonedToDate(addDays(start, 7), '00:00', tz).toISOString();
  const { data } = await supabase
    .from('appointments')
    .select('starts_at')
    .eq('kind', 'booking')
    .neq('status', 'cancelled')
    .gte('starts_at', from)
    .lt('starts_at', to);
  const counts: Record<DayKey, number> = {};
  for (const r of (data as { starts_at: string }[] | null) ?? []) {
    const k = dayKeyOf(r.starts_at, tz);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/** Minutos desde a meia-noite do dia (pode ser negativo ou passar de 1440 em bloqueios longos). */
export function minuteIn(iso: string, dayStartMs: number) {
  return (new Date(iso).getTime() - dayStartMs) / 60000;
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
