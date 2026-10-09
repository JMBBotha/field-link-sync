import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { redirectIfPasswordMissing } from '@/lib/invitePassword';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;
        if (_event === "PASSWORD_RECOVERY" && window.location.pathname !== "/set-password") window.location.replace("/set-password");
        if (!session && _event !== "SIGNED_OUT" && _event !== "INITIAL_SESSION") {
          // No session without an explicit sign-out (e.g. mid token refresh): check again, don't log out
          supabase.auth.getSession().then(({ data: { session: s } }) => {
            if (!isMounted) return;
            setSession(s);
            setUser(s?.user ?? null);
            setLoading(false);
          });
          return;
        }
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Invitees (magic link, no password yet) go to /set-password wherever the link landed. Once per user per load.
  const pwCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = user?.id;
    if (!uid || pwCheckedRef.current === uid) return;
    pwCheckedRef.current = uid;
    void redirectIfPasswordMissing();
  }, [user?.id]);

  const value: AuthContextValue = { session, user, loading };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
