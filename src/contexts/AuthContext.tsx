import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { App as CapacitorApp, type AppState } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

export interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mountedRef.current) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (mountedRef.current) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        }
      }
    );

    let appStateListener: PluginListenerHandle | null = null;
    CapacitorApp.addListener('appStateChange', (state: AppState) => {
      if (!state.isActive || !mountedRef.current) return;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (mountedRef.current) {
          setSession(session);
          setUser(session?.user ?? null);
        }
      });
    })
      .then((handle) => {
        if (!mountedRef.current) {
          void handle.remove();
          return;
        }
        appStateListener = handle;
      })
      .catch((err) => console.error('AuthProvider appStateChange listener error:', err));

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
      if (appStateListener) void appStateListener.remove();
    };
  }, []);


  return (
    <AuthContext.Provider value={{ session, user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
