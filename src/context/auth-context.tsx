import { createContext, PropsWithChildren, use, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { apiClient } from '@/services/api-client';
import { connectRealtime, disconnectRealtime } from '@/services/realtime-client';
import {
  decodeJwtPayload,
  getRefreshToken,
  logout as logoutSession,
  onSessionEnded,
  refreshIfNeeded,
  refreshSession,
  setSession,
} from '@/services/session-manager';
import type { SessionTokens } from '@/services/session-manager';
import { Contractor } from '@/types';

interface AuthUser {
  id: string;
  role: 'contractor' | 'hq_staff' | 'hq_admin';
}

interface RegisterInput {
  name: string;
  companyName?: string;
  phone: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  contractor: Contractor | null;
  isLoading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function loadContractorProfile() {
    const profile = await apiClient.get<Contractor>('/contractors/me');
    setContractor(profile);
    setUser({ id: profile.id, role: 'contractor' });
  }

  async function applyUserForRole(user: AuthUser) {
    if (user.role === 'contractor') {
      await loadContractorProfile();
    } else {
      setUser(user);
    }
  }

  async function applySession(tokens: SessionTokens) {
    await setSession(tokens);
    connectRealtime();
  }

  /** `/auth/refresh` returns only tokens (no `user`), so on a cold-launch silent refresh the role has
   * to come from the access token's own JWT payload instead — the server still verifies the signature
   * on every real request, this is purely to route the UI before the first authenticated call. */
  function decodeAccessTokenUser(accessToken: string): AuthUser | null {
    const decoded = decodeJwtPayload(accessToken);
    if (!decoded || typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') return null;
    return { id: decoded.sub, role: decoded.role as AuthUser['role'] };
  }

  // The one place this provider learns "the session is conclusively over" — fired by
  // session-manager after a definitive (non-network) /auth/refresh rejection, from whatever
  // triggered that refresh (today: only the cold-launch effect below; later phases will also
  // trigger it from a REST 401 or a socket reconnect failure, with no change needed here).
  useEffect(() => {
    return onSessionEnded(() => {
      disconnectRealtime();
      setUser(null);
      setContractor(null);
    });
  }, []);

  useEffect(() => {
    (async () => {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) {
        setIsLoading(false);
        return;
      }
      try {
        const tokens = await refreshSession();
        const decodedUser = decodeAccessTokenUser(tokens.accessToken);
        if (!decodedUser) throw new Error('Could not decode access token');
        connectRealtime();
        await applyUserForRole(decodedUser);
      } catch {
        // A definitive failure already cleared storage and fired onSessionEnded (handled above),
        // which resets user/contractor. A transient/network failure leaves storage untouched —
        // this launch simply can't establish a session, and the stored tokens remain available
        // for a later retry (e.g. reopening the app once back online).
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Runs exactly once for this provider's whole lifetime ([] deps) — re-renders never re-subscribe,
  // so there is only ever one AppState listener regardless of how often AuthProvider re-renders.
  // On every genuine background→foreground transition, asks session-manager whether the stored
  // access token is close enough to expiry to be worth refreshing proactively; refreshIfNeeded()
  // itself is the single-flight refreshSession() underneath, so this can never race a REST 401 or
  // a socket reconnect into firing a second network call. No timers or polling while backgrounded —
  // this is purely event-driven off AppState's own 'change' event.
  useEffect(() => {
    let previousAppState = AppState.currentState;

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const cameToForeground = /inactive|background/.test(previousAppState) && nextAppState === 'active';
      previousAppState = nextAppState;
      if (!cameToForeground) return;

      refreshIfNeeded().catch(() => {
        // Transient (network/timeout): session-manager already preserved the session; the existing
        // REST 401 and socket reconnect-refresh mechanisms remain responsible for recovery once an
        // actual request or reconnect happens. Definitive: onSessionEnded (subscribed above) has
        // already transitioned the app to logged-out state. Nothing further to do here either way.
      });
    });

    return () => subscription.remove();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      contractor,
      isLoading,
      login: async (phone, password) => {
        const result = await apiClient.post<{ user: AuthUser } & SessionTokens>('/auth/login', { phone, password });
        await applySession(result);
        await applyUserForRole(result.user);
      },
      register: async (input) => {
        const result = await apiClient.post<{ user: AuthUser } & SessionTokens>('/auth/register', input);
        await applySession(result);
        await applyUserForRole(result.user);
      },
      logout: async () => {
        disconnectRealtime();
        await logoutSession();
        setUser(null);
        setContractor(null);
      },
    }),
    [user, contractor, isLoading],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
