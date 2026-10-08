// 로그인 사용자 본인의 AI 대화 목록·조회·삭제. 소유권은 DB 함수가 사용자 id로 확인한다.
import { requireUser } from './_lib/auth.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { serviceRpc } from './_lib/supabase.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readId(request: Request): string | null {
  const id = new URL(request.url).searchParams.get('id');
  if (id === null) return null;
  if (!UUID.test(id)) throw new ApiFailure('BAD_REQUEST', '대화 ID가 올바르지 않습니다.', 400);
  return id.toLowerCase();
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const id = readId(request);
    if (!id)
      return json({ conversations: await serviceRpc('list_conversations', { p_user: userId }) });
    const messages = await serviceRpc('get_conversation', { p_user: userId, p_conversation: id });
    if (!Array.isArray(messages) || !messages.length)
      throw new ApiFailure('NOT_FOUND', '대화를 찾을 수 없거나 보관 기간이 지났습니다.', 404);
    return json({ id, messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const id = readId(request);
    if (!id) throw new ApiFailure('BAD_REQUEST', '삭제할 대화 ID를 보내 주세요.', 400);
    const removed = await serviceRpc('delete_conversation', { p_user: userId, p_conversation: id });
    if (removed !== true) throw new ApiFailure('NOT_FOUND', '대화를 찾을 수 없습니다.', 404);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
