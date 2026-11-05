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

// Same session AuthProvider already loads. Other modules read this instead of
// calling supabase.auth themselves, so there is one listener and one first load.
let sessionNow: Session | null = null;
let authKnown = false;
let markKnown: (session: Session | null) => void = () => {};
const known = new Promise<Session | null>((resolve) => {
  markKnown = resolve;
});

let providerActive = false;

function publishAuthSession(session: Session | null) {
  sessionNow = session;
  if (!authKnown) {
    authKnown = true;
    markKnown(session);
  }
}

/**
 * The signed-in session from AuthProvider.
 * When the provider is mounted, this waits for its first getSession and then
 * returns the latest session it published. When nothing has mounted a provider
 * (a direct call from a test), it reads the session once from here — the only
 * file allowed to call supabase.auth.
 */
async function readSessionWithoutProvider(): Promise<Session | null> {
  const auth = supabase.auth as typeof supabase.auth & {
    getSession?: () => Promise<{ data: { session: Session | null } }>;
  };
  if (typeof auth.getSession === "function") {
    try {
      const { data } = await auth.getSession();
      return data?.session ?? null;
    } catch {
      return null;
    }
  }
  try {
    const { data } = await supabase.auth.getUser();
    return data.user ? ({ user: data.user } as Session) : null;
  } catch {
    return null;
  }
}

export function waitForAuthSession(): Promise<Session | null> {
  if (providerActive) {
    if (authKnown) return Promise.resolve(sessionNow);
    return known.then(() => sessionNow);
  }
  // No provider (a public page or a test): read the current session, and do not
  // cache it, so the next call sees a sign-in that happened after this one.
  return readSessionWithoutProvider();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  providerActive = true;
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    let isMounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      publishAuthSession(session);
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
            publishAuthSession(s);
            if (!isMounted) return;
            setSession(s);
            setUser(s?.user ?? null);
            setLoading(false);
          });
          return;
        }
        publishAuthSession(session);
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

/** Null when this tree has no AuthProvider. Callers that also render in tests and public pages use this. */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext) ?? null;
}
