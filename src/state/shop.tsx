import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Barber, Hours, Rating, Service, Shop } from '../lib/types';
import { useAuth } from './auth';
import { hhmmToMin, minutesOf, todayKey, weekdayOf, WEEKDAYS_LONG, shortTime } from '../lib/time';

type ShopState = {
  loading: boolean;
  error: boolean;
  shop: Shop | null;
  hours: Hours[];
  services: Service[];
  barbers: Barber[];
  ratings: Record<string, Rating>;
  reload: () => Promise<void>;
};

const Ctx = createContext<ShopState | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const { ready, session } = useAuth();
  const [state, setState] = useState<Omit<ShopState, 'reload'>>({
    loading: true,
    error: false,
    shop: null,
    hours: [],
    services: [],
    barbers: [],
    ratings: {},
  });

  const load = useCallback(async () => {
    const [shop, hours, services, barbers, ratings] = await Promise.all([
      supabase.from('shop').select('*').eq('id', 1).maybeSingle(),
      supabase.from('business_hours').select('*').order('weekday'),
      supabase.from('services').select('*').order('sort').order('name'),
      supabase.from('barbers').select('*').order('sort').order('name'),
      supabase.rpc('barber_ratings'),
    ]);
    const failed = [shop, hours, services, barbers].some((r) => r.error);
    const r: Record<string, Rating> = {};
    for (const row of (ratings.data as Rating[] | null) ?? []) r[row.barber_id] = { ...row, average: Number(row.average) };
    setState({
      loading: false,
      error: failed,
      shop: (shop.data as Shop | null) ?? null,
      hours: (hours.data as Hours[] | null) ?? [],
      services: (services.data as Service[] | null) ?? [],
      barbers: (barbers.data as Barber[] | null) ?? [],
      ratings: r,
    });
  }, []);

  // Recarrega quando muda quem está logado (o dono vê serviços desativados também).
  const uid = session?.user.id ?? null;
  useEffect(() => {
    if (ready) void load();
  }, [ready, uid, load]);

  const value = useMemo(() => ({ ...state, reload: load }), [state, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShop() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShop fora do ShopProvider');
  return v;
}

export const tzOf = (shop: Shop | null) => shop?.timezone || 'America/Fortaleza';

/** "Aberto agora · fecha às 19:00" / "Fechado · abre amanhã às 09:00" */
export function openStatus(hours: Hours[], tz: string): { open: boolean; text: string } | null {
  if (!hours.length || !hours.some((h) => h.is_open)) return null;
  const today = todayKey(tz);
  const now = minutesOf(new Date(), tz);
  const byDay = (wd: number) => hours.find((h) => h.weekday === wd);
  const h = byDay(weekdayOf(today));
  if (h?.is_open) {
    const o = hhmmToMin(h.opens);
    const c = hhmmToMin(h.closes);
    const inBreak = h.break_start && now >= hhmmToMin(h.break_start) && now < hhmmToMin(h.break_end);
    if (now >= o && now < c && !inBreak) return { open: true, text: `Aberto agora · fecha às ${shortTime(h.closes)}` };
    if (inBreak) return { open: false, text: `Em intervalo · volta às ${shortTime(h.break_end)}` };
    if (now < o) return { open: false, text: `Fechado agora · abre hoje às ${shortTime(h.opens)}` };
  }
  for (let i = 1; i <= 7; i++) {
    const wd = (weekdayOf(today) + i) % 7;
    const n = byDay(wd);
    if (n?.is_open) {
      const when = i === 1 ? 'amanhã' : WEEKDAYS_LONG[wd].toLowerCase();
      return { open: false, text: `Fechado agora · abre ${when} às ${shortTime(n.opens)}` };
    }
  }
  return null;
}
