import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { redirectIfPasswordMissing } from '@/lib/invitePassword';
import { restoreStartupSession } from '@/lib/startupSession';
import { clearAllBookJobDrafts, clearOtherUsersBookJobDrafts } from '@/lib/bookJobDraft';

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
    const stillMounted = () => isMounted;

    const applySession = (session: Session | null) => {
      if (!stillMounted()) return;
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    };

    // Give up if storage or token refresh never settles, and leave this device unsigned.
    // Do not call signOut: the default scope revokes every device, and signOut itself waits on the same startup.
    const pending = supabase.auth.getSession();
    void restoreStartupSession(() => pending).then((result) => {
      if (!stillMounted()) return;
      if (result.error) console.error("[auth] session restore failed:", result.error);
      applySession(result.session);
    });
    // A restore that finishes after the timeout still signs this device in. It does not touch other devices.
    void pending.then(({ data: { session } }) => {
      if (session) applySession(session);
    }).catch(() => { /* restoreStartupSession already reported the rejection */ });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;
        if (_event === "PASSWORD_RECOVERY" && window.location.pathname !== "/set-password") window.location.replace("/set-password");
        if (_event === "SIGNED_OUT") clearAllBookJobDrafts();
        else if (session?.user?.id) clearOtherUsersBookJobDrafts(session.user.id);
        if (!session && _event !== "SIGNED_OUT" && _event !== "INITIAL_SESSION") {
          // No session without an explicit sign-out (e.g. mid token refresh): check again, don't log out
          void restoreStartupSession(() => supabase.auth.getSession()).then((result) => {
            if (!stillMounted()) return;
            applySession(result.session);
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
