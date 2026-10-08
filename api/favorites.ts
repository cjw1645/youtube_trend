// 로그인 사용자의 관심 영상 ID. 사용자 토큰으로 호출하므로 RLS가 본인 행만 허용한다.
import { requireUser } from './_lib/auth.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { userRest } from './_lib/supabase.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_FAVORITES = 500;

async function readVideoId(request: Request): Promise<string> {
  const text = await request.text();
  if (text.length > 256) throw new ApiFailure('BAD_REQUEST', '요청 본문이 너무 큽니다.', 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiFailure('BAD_REQUEST', '요청 형식이 올바르지 않습니다.', 400);
  }
  const id = (body as { videoId?: unknown } | null)?.videoId;
  if (typeof id !== 'string' || !VIDEO_ID.test(id))
    throw new ApiFailure('BAD_REQUEST', '올바른 영상 ID가 아닙니다.', 400);
  return id;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { token } = await requireUser(request);
    const rows = await userRest(
      token,
      `favorites?select=video_id&order=created_at.desc&limit=${MAX_FAVORITES}`,
    );
    const ids = Array.isArray(rows) ? rows.map((row) => String(row.video_id)) : [];
    return json({ ids });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const { userId, token } = await requireUser(request);
    const videoId = await readVideoId(request);
    await userRest(token, 'favorites?on_conflict=user_id,video_id', {
      method: 'POST',
      body: { user_id: userId, video_id: videoId },
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const { userId, token } = await requireUser(request);
    const videoId = await readVideoId(request);
    await userRest(token, `favorites?user_id=eq.${userId}&video_id=eq.${videoId}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
