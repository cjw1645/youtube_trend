// Supabase Auth 클라이언트. anon key는 공개용 키이며 데이터 접근은 RLS와 서버 검증이 통제한다.
// service role 키는 서버 환경변수에만 있고 이 번들에 들어오지 않는다.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** 설정이 없으면 로그인 기능 없이 기존처럼 브라우저 저장소로 동작한다. */
export const authEnabled = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = authEnabled
  ? createClient(url!, anonKey!, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
