// Supabase Cron 전용 호출 인증: COLLECT_SECRET Bearer. 브라우저는 이 값을 알지 못한다.
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiFailure } from './http.js';

const MIN_SECRET_LENGTH = 32;

export function requireCronSecret(request: Request): void {
  const secret = process.env.COLLECT_SECRET ?? '';
  // 설정이 없거나 짧으면 항상 거부한다(fail-closed).
  if (secret.length < MIN_SECRET_LENGTH)
    throw new ApiFailure('CONFIG_ERROR', '수집 인증 설정이 올바르지 않습니다.', 500);
  const given = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';
  // 길이와 무관하게 같은 길이의 해시를 상수 시간으로 비교한다.
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(secret).digest();
  if (!timingSafeEqual(a, b))
    throw new ApiFailure('UNAUTHORIZED', '허용되지 않은 호출입니다.', 401);
}
