// 로그인 사용자 본인 슬롯의 저장된 검색 결과(/api/search-snapshot)와 집계(/api/search-trend).
// Hobby 플랜의 함수 개수 제한 때문에 한 함수로 묶었다. 기존 주소는 vercel.json rewrites가 이 함수로 연결한다.
import { ApiFailure, errorResponse } from './_lib/http.js';
import { GET as snapshot } from './_lib/handlers/search-snapshot.js';
import { GET as trend } from './_lib/handlers/search-trend.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? url.pathname.split('/').pop();
  if (kind === 'snapshot' || kind === 'search-snapshot') return snapshot(request);
  if (kind === 'trend' || kind === 'search-trend') return trend(request);
  return errorResponse(new ApiFailure('NOT_FOUND', '없는 API 경로입니다.', 404));
}
