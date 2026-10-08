import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authedJson, toApiRequestError } from '../lib/api';
import { authEnabled, supabase } from '../lib/supabase';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthController {
  enabled: boolean;
  /** 저장된 세션을 확인하는 중 */
  loading: boolean;
  user: AuthUser | null;
  error: string | null;
  /** 만료 직전 토큰은 Supabase가 갱신한다. 없으면 null */
  getToken: () => Promise<string | null>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** 성공하면 null, 실패하면 안내 메시지 */
  deleteAccount: () => Promise<string | null>;
}

export const signedOut: AuthController = {
  enabled: false,
  loading: false,
  user: null,
  error: null,
  getToken: async () => null,
  signIn: async () => {},
  signOut: async () => {},
  deleteAccount: async () => '로그인 기능이 설정되지 않았습니다.',
};

const Context = createContext<AuthController>(signedOut);
export const useAuth = () => useContext(Context);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(authEnabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const apply = (session: { user: { id: string; email?: string } } | null) =>
      setUser(session ? { id: session.user.id, email: session.user.email ?? null } : null);
    supabase.auth
      .getSession()
      .then(({ data, error: failure }) => {
        if (!active) return;
        if (failure) setError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
        apply(data.session);
      })
      .catch(() => active && setError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.'))
      .finally(() => active && setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) apply(session);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const getToken = useCallback(async () => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const signIn = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    const { error: failure } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // 신원 확인용 기본 권한만 요청한다. YouTube 채널 권한은 요청하지 않는다.
      options: { redirectTo: `${location.origin}${location.pathname}` },
    });
    if (failure) setError('Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // 서버 요청이 실패해도 이 브라우저의 세션은 지운다.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setUser(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    const token = await getToken();
    if (!token) return '로그인이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요.';
    try {
      await authedJson('/api/account', token, 'DELETE', { confirm: 'delete' });
    } catch (failure) {
      return toApiRequestError(failure).message;
    }
    await signOut();
    return null;
  }, [getToken, signOut]);

  const value = useMemo<AuthController>(
    () => ({
      enabled: authEnabled,
      loading,
      user,
      error,
      getToken,
      signIn,
      signOut,
      deleteAccount,
    }),
    [loading, user, error, getToken, signIn, signOut, deleteAccount],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
