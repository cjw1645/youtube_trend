// 로그인 사용자 본인 슬롯의 검색어를 자기 지난 수집(평소)과 비교. 개인 데이터이므로 캐시하지 않고, 소유 슬롯만 DB 함수가 읽는다.
import { requireUser } from '../auth.js';
import { ApiFailure, errorResponse, json } from '../http.js';
import { serviceRpc } from '../supabase.js';
import { buildHistory, type RawHistory } from '../../../src/lib/own-history.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const slot = Number(new URL(request.url).searchParams.get('slot'));
    if (slot !== 1 && slot !== 2)
      throw new ApiFailure('BAD_REQUEST', '슬롯은 1 또는 2여야 합니다.', 400);
    const raw = await serviceRpc('get_slot_history', { p_user: userId, p_slot: slot });
    if (raw === null) return json({ history: null });
    if (typeof raw !== 'object' || !Array.isArray((raw as RawHistory).runs))
      throw new ApiFailure('UPSTREAM_ERROR', '저장된 수집 기록을 읽지 못했습니다.', 502);
    return json({ history: buildHistory(raw as RawHistory) });
  } catch (error) {
    return errorResponse(error);
  }
}
