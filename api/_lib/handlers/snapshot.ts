// 저장된 최신 공통 인기 목록 스냅샷(완료된 수집만). 마지막 성공 시각·지연·마지막 시도 상태를 함께 반환한다.
import { ApiFailure, errorResponse, json } from '../http.js';
import { serviceRpc } from '../supabase.js';

const CACHE = 'public, s-maxage=300, stale-while-revalidate=600';

export async function GET(): Promise<Response> {
  try {
    const body = await serviceRpc('get_latest_popular', {});
    if (!body || typeof body !== 'object' || !('last_attempt' in body))
      throw new ApiFailure('UPSTREAM_ERROR', '저장된 목록을 읽지 못했습니다.', 502);
    return json(body, { cache: CACHE });
  } catch (error) {
    return errorResponse(error);
  }
}
