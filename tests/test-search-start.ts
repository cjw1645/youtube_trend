import assert from 'node:assert/strict';
import { resolveSearchStart } from '../src/lib/search-start.ts';
// 영상 검색 화면의 시작 상태: 이전 검색어를 복원해도 검색을 실행하지 않는다(검색 횟수 소모 방지).

const empty = { q: '', categoryId: '', order: '' as const };

// 아무것도 없으면 인기 차트로 시작
assert.deepEqual(resolveSearchStart(undefined, undefined), { query: empty, draft: '' });

// 세션에 남은 이전 검색어: 입력창에만 채우고 실행(q)은 비운다. 이전 결과의 필터도 되살리지 않는다.
const restored = resolveSearchStart(undefined, {
  q: '고양이 간식',
  categoryId: '15',
  order: 'date',
});
assert.deepEqual(restored, { query: empty, draft: '고양이 간식' });
assert.equal(restored.query.q, '', '복원만으로는 검색하지 않는다');

// 다른 화면의 명시적 검색 요청은 바로 실행한다(복원값보다 우선)
const requested = resolveSearchStart(
  { q: '반려동물', id: 1 },
  { q: '고양이 간식', categoryId: '', order: '' },
);
assert.deepEqual(requested, { query: { ...empty, q: '반려동물' }, draft: '반려동물' });

console.log('test-search-start: all passed');
