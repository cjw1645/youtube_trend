// 로그인 사용자의 검색어 슬롯(최대 2개): 조회·등록/변경·해제. 사용자 id는 검증된 토큰에서만 정한다.
import { requireUser } from './_lib/auth.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { parseSlotInput, registerSearchSlot } from './_lib/search.js';
import { serviceRpc } from './_lib/supabase.js';

async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 1024) throw new ApiFailure('BAD_REQUEST', '요청 본문이 너무 큽니다.', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiFailure('BAD_REQUEST', '요청 형식이 올바르지 않습니다.', 400);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const view = await serviceRpc('get_search_slot_view', { p_user: userId });
    return json(view);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const input = parseSlotInput(await readBody(request));
    const result = await registerSearchSlot(userId, input);
    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const slot = ((await readBody(request)) as { slot?: unknown } | null)?.slot;
    if (slot !== 1 && slot !== 2)
      throw new ApiFailure('BAD_REQUEST', '슬롯은 1 또는 2여야 합니다.', 400);
    const removed = await serviceRpc('clear_search_slot', { p_user: userId, p_slot: slot });
    return json({ ok: true, removed: removed === true });
  } catch (error) {
    return errorResponse(error);
  }
}
