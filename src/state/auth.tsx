import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

type AuthState = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  /** true quando o perfil de quem está logado já foi buscado (ou não tem ninguém logado). */
  profileReady: boolean;
  isAdmin: boolean;
  recovering: boolean;
  clearRecovering: () => void;
  refreshProfile: () => Promise<Profile | null>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

async function loadProfile(userId: string) {
  const { data } = await supabase.from('profiles').select('id, full_name, phone, role').eq('id', userId).maybeSingle();
  return (data as Profile | null) ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let alive = true;
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
      if (!s) setProfile(null);
    });
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      if (data.session) {
        const id = data.session.user.id;
        setProfile(await loadProfile(id));
        setProfileFor(id);
      }
      setReady(true);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!ready || !userId || profileFor === userId) return;
    let alive = true;
    loadProfile(userId).then((p) => {
      if (!alive) return;
      setProfile(p);
      setProfileFor(userId);
    });
    return () => {
      alive = false;
    };
  }, [ready, userId, profileFor]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return null;
    const p = await loadProfile(userId);
    setProfile(p);
    setProfileFor(userId);
    return p;
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthState>(() => {
    const own = profile && profile.id === userId ? profile : null;
    return {
      ready,
      session,
      profile: own,
      profileReady: !userId || profileFor === userId,
      isAdmin: own?.role === 'admin',
      recovering,
      clearRecovering: () => setRecovering(false),
      refreshProfile,
      signOut,
    };
  }, [ready, session, profile, userId, profileFor, recovering, refreshProfile, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}
