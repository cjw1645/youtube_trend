// 로그인 사용자 본인 슬롯의 검색 결과와 인기 차트 비교. 개인 데이터이므로 캐시하지 않고, 소유 슬롯만 DB 함수가 읽는다.
import { requireUser } from '../auth.js';
import { loadSlotCompare } from '../compare.js';
import { ApiFailure, errorResponse, json } from '../http.js';

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await requireUser(request);
    const slot = Number(new URL(request.url).searchParams.get('slot'));
    if (slot !== 1 && slot !== 2)
      throw new ApiFailure('BAD_REQUEST', '슬롯은 1 또는 2여야 합니다.', 400);
    return json({ compare: await loadSlotCompare(userId, slot) });
  } catch (error) {
    return errorResponse(error);
  }
}
