// 공통 인기 목록 수집 진입점. Supabase Cron(pg_net)만 호출한다: 브라우저는 비밀 값을 알지 못한다.
import { runPopularCollection } from './_lib/collect.js';
import { requireCronSecret } from './_lib/cron-auth.js';
import { errorResponse, json } from './_lib/http.js';

export async function POST(request: Request): Promise<Response> {
  try {
    requireCronSecret(request);
    const summary = await runPopularCollection();
    const failed = summary.state === 'incomplete' || summary.state === 'store_failed';
    return json(summary, { status: failed ? 502 : summary.state === 'storage_hold' ? 503 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
