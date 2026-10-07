import type { CategoriesResponse } from '../src/types/video.js';
import { ApiFailure, errorResponse, json } from './_lib/http.js';
import { listCategories, listCategoriesById } from './_lib/youtube.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (id !== null && !/^\d{1,4}(,\d{1,4}){0,49}$/.test(id))
      throw new ApiFailure('BAD_REQUEST', '카테고리 ID 목록이 올바르지 않습니다.', 400);
    const body: CategoriesResponse = {
      items: id ? await listCategoriesById([...new Set(id.split(','))]) : await listCategories(),
    };
    return json(body, { cache: 'public, s-maxage=86400, stale-while-revalidate=86400' });
  } catch (err) {
    return errorResponse(err);
  }
}
