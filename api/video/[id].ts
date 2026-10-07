import { ApiFailure, errorResponse, json } from '../_lib/http.js';
import { getVideoDetail } from '../_lib/youtube.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const match = new URL(request.url).pathname.match(/^\/api\/video\/([A-Za-z0-9_-]{11})\/?$/);
    if (!match) throw new ApiFailure('BAD_REQUEST', '영상 ID가 올바르지 않습니다.', 400);

    return json(await getVideoDetail(match[1]), {
      cache: 'public, s-maxage=600, stale-while-revalidate=1200',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
