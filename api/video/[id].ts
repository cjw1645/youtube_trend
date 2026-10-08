import { ApiFailure, errorResponse, json } from '../_lib/http.js';
import { chargePublicYoutube } from '../_lib/public-budget.js';
import { getVideoDetail } from '../_lib/youtube.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const match = new URL(request.url).pathname.match(/^\/api\/video\/([A-Za-z0-9_-]{11})\/?$/);
    if (!match) throw new ApiFailure('BAD_REQUEST', '영상 ID가 올바르지 않습니다.', 400);
    // 경로의 ID 외에는 쿼리 파라미터를 받지 않는다(배포 환경이 붙이는 같은 id 값은 허용). 캐시 우회를 막는다.
    for (const [key, value] of new URL(request.url).searchParams)
      if (key !== 'id' || value !== match[1])
        throw new ApiFailure('BAD_REQUEST', `지원하지 않는 요청 파라미터입니다: ${key}`, 400);
    await chargePublicYoutube(2);

    return json(await getVideoDetail(match[1]), {
      cache: 'public, s-maxage=600, stale-while-revalidate=1200',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
