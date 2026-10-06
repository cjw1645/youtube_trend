// 명시적으로 실행할 때만 로컬 /api/chat에서 실제 Gemini 응답을 검증한다.
// Key와 환경 파일에 접근하지 않는다. 실행 예: npm run verify:chat-live -- --run-live --source=fixture
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import type { ChatResponse } from '../src/types/chat.ts';
import type { VideosResponse } from '../src/types/video.ts';

if (!process.argv.includes('--run-live')) throw new Error('실제 Gemini를 호출합니다. --run-live를 명시해 주세요.');
const base = new URL(process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? 'http://localhost:3010');
const production = process.argv.includes('--production') && base.origin === 'https://youtube-trend-orpin.vercel.app';
if (!production && (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname))) throw new Error('로컬 API 또는 --production으로 명시한 프로젝트 배포 주소만 사용할 수 있습니다.');
const source = process.argv.find((arg) => arg.startsWith('--source='))?.slice(9);
if (!['fixture', 'live'].includes(source ?? '')) throw new Error('--source=fixture 또는 --source=live로 YouTube 검증 조건을 기록해 주세요.');
if (production && source !== 'live') throw new Error('Production은 --source=live로 검증하세요.');
const listResponse = await fetch(new URL('/api/videos?categoryId=10&order=viewCount', base), { signal: AbortSignal.timeout(20_000) });
if (!listResponse.ok) throw new Error(`목록 조회 실패: HTTP ${listResponse.status}`);
const list = await listResponse.json() as VideosResponse;
const ids = list.items.slice(0, 3).map((video) => video.id);
assert.equal(ids.length, 3, '세 질문의 대상 경계 검증에 영상 3개가 필요합니다.');

const selectedQuestions = process.argv.find((arg) => arg.startsWith('--questions='))?.slice(12).split(',') ?? ['1', '2', '3'];
if (selectedQuestions.some((value) => !['1', '2', '3'].includes(value))) throw new Error('--questions는 1,2,3 중 선택하세요.');
const questions = [
  ['현재 유튜브 트렌드를 분석해줘', 3],
  ['이 영상이 인기 있는 이유를 분석해줘', 1],
  ['다음 콘텐츠 아이디어 3개를 제안해줘', 2],
] as const;
for (const [index, [question, count]] of questions.entries()) {
  if (!selectedQuestions.includes(String(index + 1))) continue;
  const response = await fetch(new URL('/api/chat', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, videoIds: ids.slice(0, count) }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const body = await response.json() as { code?: string };
    throw new Error(`실제 Gemini 검증 실패: HTTP ${response.status}, ${body.code ?? 'UNKNOWN'}`);
  }
  const body = await response.json() as ChatResponse;
  const verifiedAt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
  const record = { verifiedAt, url: base.href, youtube: source, gemini: 'live', question, status: response.status, cache: response.headers.get('Cache-Control'), model: body.model, answer: body.answer, evidence: body.context.videos.map((v) => ({ id: v.id, title: v.title, viewCount: v.viewCount, publishedAt: v.publishedAt })) };
  // 출력 형식이 실패해도 실제 응답을 보존하여 수동 점검할 수 있게 한다.
  await appendFile('docs/DECISION.md', `\n### 실제 응답 검증: ${question}\n${JSON.stringify(record, null, 2)}\n`);
  const plain = body.answer.replaceAll('**', '');
  const sections = ['[핵심 요약]', '[근거 데이터]', '[콘텐츠 제안]'];
  const positions = sections.map((section) => plain.indexOf(section));
  assert.ok(positions[0] >= 0 && positions[1] > positions[0] && positions[2] > positions[1], '세 섹션 순서');
  const summary = plain.slice(positions[0], positions[1]);
  const bullets = summary.match(/^\s*-\s+/gm)?.length ?? 0;
  assert.ok(bullets >= 2 && bullets <= 3, '핵심 요약 2~3줄');
  const evidence = plain.slice(positions[1], positions[2]);
  for (const video of body.context.videos) {
    assert.ok(evidence.includes(video.title), `제목 대조: ${video.id}`);
    assert.ok(evidence.includes(video.publishedAt.slice(0, 10)), `날짜 대조: ${video.id}`);
    assert.ok(video.viewCount === null ? evidence.includes('정보 없음') : evidence.includes(String(video.viewCount)) || evidence.includes(video.viewCount.toLocaleString('en-US')), `조회수 대조: ${video.id}`);
  }
  if (count === 3) {
    const ranked = [...body.context.videos].sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
    const indices = ranked.map((video) => evidence.indexOf(video.title));
    assert.ok(indices[1] > indices[0] && indices[2] > indices[1], '대상 내 조회수 상위3 순서');
  } else {
    assert.match(plain, /부족|제한|어렵|미만|단일|1개|2개|한 편|두 편/, '제한된 대상 안내');
  }
  const ideas = plain.slice(positions[2]);
  assert.equal(ideas.match(/^\s*[123]\.\s*제목\s*:/gm)?.length, 3, '제안 3개');
  for (const label of ['소재', '썸네일', '구성 방향', '참고 근거']) assert.equal(ideas.match(new RegExp(`^\\s*-\\s*${label}\\s*:`, 'gm'))?.length, 3, `${label} 3개`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(body.context.requestedIds, ids.slice(0, count));
  console.log(JSON.stringify({ verifiedAt, question, count, status: response.status, model: body.model, evidence: record.evidence, checks: 'PASS' }));
}
