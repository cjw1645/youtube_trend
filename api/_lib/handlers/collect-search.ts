// 활성 검색 집합의 매일 일괄 갱신 진입점(Supabase Cron 전용, COLLECT_SECRET Bearer).
import { requireCronSecret } from '../cron-auth.js';
import { errorResponse, json } from '../http.js';
import { runSearchBatch } from '../search.js';

export async function POST(request: Request): Promise<Response> {
  try {
    requireCronSecret(request);
    return json(await runSearchBatch());
  } catch (error) {
    return errorResponse(error);
  }
}
