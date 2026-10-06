// GET /api/videos?q=&categoryId=&order=viewCount|date
// q가 없으면 인기 급상승(mostPopular, 1 unit), 있으면 검색(search.list 100 unit + videos.list 1 unit)
import type { SortOrder, VideosResponse } from '../src/types/video.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { listPopularVideos, searchVideos, sortVideos } from './_lib/youtube.js';

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

    if (q.length > 100) throw new ApiFailure('BAD_REQUEST', '검색어는 100자 이하로 입력해 주세요.', 400);
    if (categoryId && !/^\d+$/.test(categoryId)) {
      throw new ApiFailure('BAD_REQUEST', '카테고리 값이 올바르지 않습니다.', 400);
    }

    const videos = q ? await searchVideos(q, { categoryId, order }) : await listPopularVideos(categoryId);
    const body: VideosResponse = { items: sortVideos(videos, order) };
    return json(body, { cache: q ? CACHE_SEARCH : CACHE_POPULAR });
  } catch (err) {
    return errorResponse(err);
  }
}
