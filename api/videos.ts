// 키워드 검색은 로그인 사용자만, 호출 전에 개인·전체 검색 한도를 예약한다. 카테고리·정렬은 클라이언트가 로컬로 처리한다.
import type { VideosResponse } from '../src/types/video.js';
import { requireUser } from './_lib/auth.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { chargePublicYoutube, rejectUnknownParams } from './_lib/public-budget.js';
import { ensureBudgets } from './_lib/search.js';
import { reserveSearch, settleUsage } from './_lib/usage.js';
import {
  listAllPopularVideos,
  getVideosByIds,
  listPopularVideos,
  POPULAR_MAX_PAGES,
  searchVideos,
} from './_lib/youtube.js';

const CACHE_POPULAR = 'public, s-maxage=600, stale-while-revalidate=1200';
const CACHE_SEARCH = 'public, s-maxage=1800, stale-while-revalidate=3600';
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const q = (params.get('q') ?? '').trim();

    if (q.length > 100)
      throw new ApiFailure('BAD_REQUEST', '검색어는 100자 이하로 입력해 주세요.', 400);
    // 카테고리·정렬은 서버로 보내지 않는다(받은 목록 안에서 화면이 거른다). 허용 밖 파라미터는 캐시 우회에 쓰이므로 거부한다.
    rejectUnknownParams(params, ['q', 'requestId', 'ids', 'chart', 'all']);

    // ids=a,b,...: 관심 영상 표시용 일괄 조회(최대 50개). 다른 조건과 함께 쓸 수 없다.
    const idsParam = params.get('ids');
    if (idsParam !== null) {
      const ids = [...new Set(idsParam.split(',').filter(Boolean))];
      if (
        q ||
        params.get('chart') !== null ||
        !ids.length ||
        ids.length > 50 ||
        ids.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))
      ) {
        throw new ApiFailure(
          'BAD_REQUEST',
          'ids는 올바른 영상 ID 1–50개만 사용할 수 있습니다.',
          400,
        );
      }
      await chargePublicYoutube(1);
      const body: VideosResponse = { items: await getVideosByIds(ids) };
      return json(body, { cache: CACHE_SEARCH });
    }

    // chart=popular&all=1: 전체 인기 차트를 pageToken으로 끝까지 수집한다.
    const chart = params.get('chart');
    if (chart !== null) {
      if (chart !== 'popular' || params.get('all') !== '1' || q) {
        throw new ApiFailure('BAD_REQUEST', 'chart=popular는 all=1만 함께 쓸 수 있습니다.', 400);
      }
      await chargePublicYoutube(POPULAR_MAX_PAGES);
      const body: VideosResponse = { items: await listAllPopularVideos() };
      return json(body, { cache: CACHE_POPULAR });
    }

    if (!q) {
      await chargePublicYoutube(1);
      const body: VideosResponse = { items: await listPopularVideos() };
      return json(body, { cache: CACHE_POPULAR });
    }

    // 키워드 검색(search.list 1회): 로그인 필수. 같은 requestId 재전송은 다시 호출하지 않는다.
    const { userId } = await requireUser(request);
    const requestId = params.get('requestId') ?? '';
    if (!REQUEST_ID.test(requestId))
      throw new ApiFailure('BAD_REQUEST', '검색 요청 ID가 올바르지 않습니다.', 400);
    const now = new Date();
    await ensureBudgets(now);
    const reservation = await reserveSearch(userId, requestId, 1, now);
    if (reservation.duplicate)
      throw new ApiFailure('BAD_REQUEST', '이미 처리한 검색 요청입니다. 다시 검색해 주세요.', 409);
    let outcome: 'settled' | 'failed_unknown' = 'failed_unknown';
    try {
      const items = await searchVideos(q);
      outcome = 'settled';
      const body: VideosResponse = { items };
      return json(body); // 사용자별 응답이라 공용 캐시에 두지 않는다.
    } finally {
      await settleUsage(userId, reservation.id, outcome).catch(() => undefined);
    }
  } catch (err) {
    return errorResponse(err);
  }
}
