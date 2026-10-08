// 로그인 없이 호출할 수 있는 공개 엔드포인트의 YouTube 호출을 호출 전에 하루 유닛 예산으로 막는다.
// CDN 캐시에 걸린 응답은 서버를 거치지 않으므로 소비하지 않는다. 예산 저장소 장애면 운영(production)에서는 호출을 막는다.
import { kstDay } from './collect.js';
import { ApiFailure } from './http.js';
import { serviceRpc } from './supabase.js';

/** 서비스 전체 하루 공개 조회 유닛 상한(운영자 내부 기준) */
const DEFAULT_PUBLIC_CAP = 500;

/** 허용 목록 밖의 쿼리 파라미터는 거부한다. 임의 파라미터로 CDN 캐시를 피해 YouTube를 반복 호출하지 못하게 한다. */
export function rejectUnknownParams(params: URLSearchParams, allowed: readonly string[]): void {
  for (const key of params.keys())
    if (!allowed.includes(key))
      throw new ApiFailure('BAD_REQUEST', `지원하지 않는 요청 파라미터입니다: ${key}`, 400);
}

/** YouTube를 호출하기 전에 공개 조회 예산에서 units를 소비한다. 한도를 넘으면 429. */
export async function chargePublicYoutube(units: number, now: Date = new Date()): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.VERCEL_ENV !== 'production') return;
  const day = kstDay(now);
  await serviceRpc('ensure_quota_row', {
    p_kind: 'public_youtube',
    p_day: day,
    p_cap: Number(process.env.PUBLIC_YOUTUBE_DAILY_UNIT_CAP) || DEFAULT_PUBLIC_CAP,
  });
  const granted = await serviceRpc('try_consume_quota', {
    p_kind: 'public_youtube',
    p_day: day,
    p_units: units,
  });
  if (granted !== true)
    throw new ApiFailure(
      'QUOTA_EXCEEDED',
      '오늘 공개 조회 가능 횟수를 모두 사용했습니다. 내일 다시 시도해 주세요.',
      429,
    );
}
