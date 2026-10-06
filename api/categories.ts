// GET /api/categories — 한국 지역 영상 카테고리 (1 unit, 하루 캐시)
import type { CategoriesResponse } from '../src/types/video.js';
import { errorResponse, json } from './_lib/http.js';
import { listCategories } from './_lib/youtube.js';

export async function GET(): Promise<Response> {
  try {
    const body: CategoriesResponse = { items: await listCategories() };
    return json(body, { cache: 'public, s-maxage=86400, stale-while-revalidate=86400' });
  } catch (err) {
    return errorResponse(err);
  }
}
