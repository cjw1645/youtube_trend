// 기본 홈은 카테고리 제한 없는 인기 목록. 키워드/카테고리는 검색 후 통계 일괄 보완.
import type { SortOrder, VideosResponse } from '../src/types/video.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import {
  listAllPopularVideos,
  listPopularVideos,
  searchVideos,
  sortVideos,
} from './_lib/youtube.js';

const CACHE_POPULAR = 'public, s-maxage=600, stale-while-revalidate=1200';
const CACHE_SEARCH = 'public, s-maxage=1800, stale-while-revalidate=3600';

function parseOrder(value: string | null): SortOrder | undefined {
  if (!value) return undefined;
  if (value === 'viewCount' || value === 'date') return value;
  throw new ApiFailure('BAD_REQUEST', 'order는 viewCount 또는 date만 사용할 수 있습니다.', 400);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const q = (params.get('q') ?? '').trim();
    const categoryId = params.get('categoryId') || undefined;
    const order = parseOrder(params.get('order'));

    if (q.length > 100)
      throw new ApiFailure('BAD_REQUEST', '검색어는 100자 이하로 입력해 주세요.', 400);
    if (categoryId && !/^\d+$/.test(categoryId)) {
      throw new ApiFailure('BAD_REQUEST', '카테고리 값이 올바르지 않습니다.', 400);
    }

    // chart=popular&all=1: 전체 인기 차트를 pageToken으로 끝까지 수집한다. 카테고리별 차트·검색은 쓰지 않는다.
    const chart = params.get('chart');
    if (chart !== null) {
      if (chart !== 'popular' || params.get('all') !== '1' || q || categoryId || order) {
        throw new ApiFailure('BAD_REQUEST', 'chart=popular는 all=1만 함께 쓸 수 있습니다.', 400);
      }
      const body: VideosResponse = { items: await listAllPopularVideos() };
      return json(body, { cache: CACHE_POPULAR });
    }

    const searching = !!(q || categoryId);
    const videos = searching
      ? await searchVideos(q, { categoryId, order })
      : await listPopularVideos();
    const body: VideosResponse = { items: sortVideos(videos, order) };
    return json(body, { cache: searching ? CACHE_SEARCH : CACHE_POPULAR });
  } catch (err) {
    return errorResponse(err);
  }
}
