// 저장된 공통 인기 목록 스냅샷(/api/snapshot)과 집계 트렌드(/api/trend). 공개 집계만 반환한다.
// Hobby 플랜의 함수 개수 제한 때문에 한 함수로 묶었다. 기존 주소는 vercel.json rewrites가 이 함수로 연결한다.
import { ApiFailure, errorResponse } from './_lib/http.js';
import { GET as snapshot } from './_lib/handlers/snapshot.js';
import { GET as trend } from './_lib/handlers/trend.js';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? url.pathname.split('/').pop();
  if (kind === 'snapshot') return snapshot();
  if (kind === 'trend') return trend();
  return errorResponse(new ApiFailure('NOT_FOUND', '없는 API 경로입니다.', 404));
}
