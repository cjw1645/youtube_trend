// 계정: GET은 오늘의 사용량 요약, DELETE는 계정 삭제.
// 삭제하면 관심·대화·검색 슬롯·사용량 예약은 DB의 cascade로 함께 삭제된다. 공개 수집 데이터는 계정과 무관하다.
import { requireUser } from './_lib/auth.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { deleteAuthUser } from './_lib/supabase.js';
import { getUsageSummary } from './_lib/usage.js';

/** 오늘 남은 AI 질문·검색 횟수 표시용. 개인 데이터이므로 캐시하지 않는다. */
export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    return json({ usage: await getUsageSummary(userId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const text = await request.text();
    let confirm: unknown;
    try {
      confirm = (JSON.parse(text) as { confirm?: unknown } | null)?.confirm;
    } catch {
      confirm = undefined;
    }
    if (confirm !== 'delete') throw new ApiFailure('BAD_REQUEST', '삭제 확인이 필요합니다.', 400);
    await deleteAuthUser(userId);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
