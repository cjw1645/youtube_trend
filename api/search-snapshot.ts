// 로그인 사용자 본인 슬롯의 최신 검색 결과 스냅샷(영상 목록 포함). 개인 데이터이므로 캐시하지 않는다.
import { requireUser } from './_lib/auth.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { serviceRpc } from './_lib/supabase.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const slot = Number(new URL(request.url).searchParams.get('slot'));
    if (slot !== 1 && slot !== 2)
      throw new ApiFailure('BAD_REQUEST', '슬롯은 1 또는 2여야 합니다.', 400);
    const view = await serviceRpc('get_search_slot_view', {
      p_user: userId,
      p_slot: slot,
      p_include_videos: true,
    });
    return json(view);
  } catch (error) {
    return errorResponse(error);
  }
}
