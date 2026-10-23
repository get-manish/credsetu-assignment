import * as SecureStore from 'expo-secure-store';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAuthToken, setUnauthorizedHandler, User } from '../api/client';

// SecureStore keeps values in the iOS Keychain / Android Keystore (encrypted),
// unlike AsyncStorage which is plain text.
const TOKEN_KEY = 'miniledger.token';
const USER_KEY = 'miniledger.user';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  loading: boolean; // true while we check SecureStore at app start
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On app start: restore a saved session (auto-login).
  useEffect(() => {
    (async () => {
      try {
        const [savedToken, savedUser] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (savedToken) {
          setAuthToken(savedToken);
          setToken(savedToken);
          setUser(savedUser ? (JSON.parse(savedUser) as User) : null);
        }
      } catch {
        // Unreadable storage: treat as logged out.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (newToken: string, newUser: User) => {
    setAuthToken(newToken);
    setToken(newToken);
    setUser(newUser);
    await SecureStore.setItemAsync(TOKEN_KEY, newToken);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(newUser));
  }, []);

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    await SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined);
  }, []);

  // Any 401 from the API (expired token) triggers a logout.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const value = useMemo(
    () => ({ token, user, loading, signIn, signOut }),
    [token, user, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook: `const { token, signOut } = useAuth()` in any screen.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
