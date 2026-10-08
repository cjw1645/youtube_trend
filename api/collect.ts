// 수집 진입점(Supabase Cron 전용, COLLECT_SECRET Bearer). 공통 인기 목록과 개인 검색 일괄 갱신을 한 함수로 묶었다
// (Hobby 플랜의 함수 개수 제한). /api/collect-search는 vercel.json rewrites가 job=search로 연결한다.
import { ApiFailure, errorResponse } from './_lib/http.js';
import { POST as popular } from './_lib/handlers/collect-popular.js';
import { POST as search } from './_lib/handlers/collect-search.js';

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const job =
    url.searchParams.get('job') ??
    (url.pathname.endsWith('/collect-search') ? 'search' : 'popular');
  if (job === 'popular') return popular(request);
  if (job === 'search') return search(request);
  return errorResponse(new ApiFailure('BAD_REQUEST', '수집 종류가 올바르지 않습니다.', 400));
}
