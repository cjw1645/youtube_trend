// Supabase Auth가 발급한 액세스 토큰을 서명·발급자·대상·만료까지 검증한다.
// 사용자 신원은 오직 이 검증 결과(sub)에서만 가져온다. 본문·쿼리의 userId는 사용하지 않는다.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ApiFailure } from './http.js';
import { supabaseUrl } from './supabase.js';

export interface AuthUser {
  userId: string;
  token: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unauthorized = () =>
  new ApiFailure('UNAUTHORIZED', '로그인이 필요하거나 만료되었습니다.', 401);

let cached: { url: string; keys: JWTVerifyGetKey } | undefined;
function keysFor(url: string): JWTVerifyGetKey {
  if (cached?.url !== url)
    cached = { url, keys: createRemoteJWKSet(new URL(`${url}/auth/v1/.well-known/jwks.json`)) };
  return cached.keys;
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (!match) throw unauthorized();
  const url = supabaseUrl();
  try {
    const { payload } = await jwtVerify(match[1], keysFor(url), {
      issuer: `${url}/auth/v1`,
      audience: 'authenticated',
      // 대칭키(HS*)는 허용하지 않는다(알고리즘 혼동 방지). 비대칭 서명 키만 받는다.
      algorithms: ['ES256', 'RS256'],
    });
    if (
      payload.role !== 'authenticated' ||
      typeof payload.sub !== 'string' ||
      !UUID.test(payload.sub)
    )
      throw unauthorized();
    return { userId: payload.sub.toLowerCase(), token: match[1] };
  } catch (error) {
    if (error instanceof ApiFailure) throw error;
    throw unauthorized();
  }
}
