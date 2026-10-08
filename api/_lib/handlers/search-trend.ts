// 로그인 사용자 본인 슬롯의 트렌드 집계. 개인 데이터이므로 캐시하지 않고, 소유 슬롯만 DB 함수가 읽는다.
import { requireUser } from '../auth.js';
import { ApiFailure, errorResponse, json } from '../http.js';
import { serviceRpc } from '../supabase.js';
import { buildTrend, type TrendInputs } from '../trend.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const slot = Number(new URL(request.url).searchParams.get('slot'));
    if (slot !== 1 && slot !== 2)
      throw new ApiFailure('BAD_REQUEST', '슬롯은 1 또는 2여야 합니다.', 400);
    const inputs = await serviceRpc('get_slot_trend_inputs', { p_user: userId, p_slot: slot });
    if (inputs === null) return json({ trend: null });
    if (typeof inputs !== 'object' || !('current' in inputs))
      throw new ApiFailure('UPSTREAM_ERROR', '저장된 집계를 읽지 못했습니다.', 502);
    return json({ trend: buildTrend(inputs as TrendInputs) });
  } catch (error) {
    return errorResponse(error);
  }
}
