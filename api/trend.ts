// 공통 인기 목록의 저장된 집계 기반 트렌드(키워드·카테고리·길이 구간·잔류/신규/이탈 비교). 공개 집계만 반환한다.
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { serviceRpc } from './_lib/supabase.js';
import { buildTrend, type TrendInputs } from './_lib/trend.js';

const CACHE = 'public, s-maxage=300, stale-while-revalidate=600';

export async function GET(): Promise<Response> {
  try {
    const inputs = await serviceRpc('get_popular_trend_inputs', {});
    if (inputs === null) return json({ trend: null }, { cache: CACHE });
    if (typeof inputs !== 'object' || !('current' in inputs))
      throw new ApiFailure('UPSTREAM_ERROR', '저장된 집계를 읽지 못했습니다.', 502);
    return json({ trend: buildTrend(inputs as TrendInputs) }, { cache: CACHE });
  } catch (error) {
    return errorResponse(error);
  }
}
