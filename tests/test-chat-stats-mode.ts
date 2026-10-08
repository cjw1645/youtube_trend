import assert from 'node:assert/strict';
import { createServer } from 'vite';
import type { AnalysisContext, AnalysisVideo } from '../src/types/chat.ts';
import {
  firstSentence,
  firstSentenceHas,
  hasSections,
  ungroundedNumbers,
} from './chat-answer-checks.ts';
// 로컬 전용: 질문 유형 판별·통계 모드 입력·숫자 근거 검사. 외부 API 호출 없음(모의 답변).
const vite = await createServer({
  configFile: false,
  envDir: 'tmp/no-env',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { buildChatInput, classifyQuestion, renderChatReferences, CHAT_SYSTEM_INSTRUCTION } =
    await vite.ssrLoadModule('/api/_lib/chat-prompt.ts');
  const NOW = Date.parse('2026-10-07T03:00:00Z');
  const videos: AnalysisVideo[] = Array.from({ length: 20 }, (_, index) => ({
    id: `lol${String(index).padStart(8, '0')}`,
    title: `[2026 LCK] T1 vs GEN ${index + 1}세트 하이라이트`,
    description: '',
    tags: ['리그오브레전드', 'LCK 2026'],
    category: '게임',
    publishedAt: new Date(NOW - (index + 1) * 2 * 86_400_000).toISOString(),
    viewCount: index === 7 ? null : 100_000 + index * 37_123,
    likeCount: index === 3 ? null : index === 5 ? 0 : 1_000 + index * 77,
    commentCount: 100 + index * 11,
    channelTitle: 'LCK',
    subscriberCount: 1_230_000,
  }));
  const context: AnalysisContext = {
    requestedIds: videos.map((video) => video.id),
    analyzedIds: videos.map((video) => video.id),
    excludedIds: [],
    videos,
  };
  const fmt = (value: number) => value.toLocaleString('ko-KR');

  // 1) 질문 유형: 통계어가 있고 해석·기획 요청어가 없으면 stats
  const statsQuestions = [
    '롤 영상 평균 조회수 분석해줘',
    '조회수 합계와 중앙값 알려줘',
    '조회수가 가장 높은 영상은?',
    '좋아요 평균은?',
  ];
  const analysisQuestions = [
    '현재 유튜브 트렌드를 분석해줘',
    '이 영상이 인기 있는 이유를 분석해줘',
    '다음 콘텐츠 아이디어 3개를 제안해줘',
  ];
  for (const question of statsQuestions)
    assert.equal(classifyQuestion(question), 'stats', question);
  for (const question of analysisQuestions)
    assert.equal(classifyQuestion(question), 'analysis', question);
  for (const question of [
    '평균 조회수가 높은 이유를 분석해줘',
    '조회수 최고 영상 기반으로 기획 제안해줘',
    '좋아요 비율이 높은 트렌드는?',
    '총평해줘',
    '제목만 나열해',
  ])
    assert.equal(classifyQuestion(question), 'analysis', question);
  for (const question of [
    '영상 몇 개야?',
    '쇼츠 개수 알려줘',
    '총 조회수는?',
    '좋아요 비율 알려줘',
  ])
    assert.equal(classifyQuestion(question), 'stats', question);

  // 2) 입력: mode·aggregates, stats 지시문에는 3단 양식이 없고 analysis 지시문은 기존 양식 그대로
  for (const question of analysisQuestions) {
    const input = buildChatInput(question, context, { source: 'search' }, NOW);
    const payload = JSON.parse(input.prompt);
    assert.equal(payload.mode, 'analysis');
    assert.equal(input.systemInstruction, CHAT_SYSTEM_INSTRUCTION);
    assert.match(input.systemInstruction, /세 섹션을 이 순서로/);
    assert.ok(payload.responseChecks.evidence && payload.responseChecks.proposals);
  }

  // 3) 모의 답변: 첫 문장에 aggregates 값, 섹션 없음, 숫자 근거 검사 통과
  const cases: [string, (agg: any) => { answer: string; expected: number[] }][] = [
    [
      statsQuestions[0],
      ({ viewCount: v }) => ({
        answer: `선택한 ${v.total - v.nullExcluded}개 영상의 평균 조회수는 ${fmt(v.average)}회입니다. 대상 ${v.total}개 중 조회수 정보가 없는 ${v.nullExcluded}개를 빼고 합계 ${fmt(v.sum)}회를 ${v.total - v.nullExcluded}개로 나눈 값입니다. 중앙값은 ${fmt(v.median)}회이고, 가장 많이 본 {{title:${v.max.id}}}는 {{views:${v.max.id}}}회, 일평균 {{daily:${v.max.id}}}회입니다.`,
        expected: [v.average],
      }),
    ],
    [
      statsQuestions[1],
      ({ viewCount: v }) => ({
        answer: `조회수 합계는 ${fmt(v.sum)}회, 중앙값은 ${fmt(v.median)}회입니다. 대상 ${v.total}개 중 정보 없음 ${v.nullExcluded}개를 뺀 값입니다.`,
        expected: [v.sum, v.median],
      }),
    ],
    [
      statsQuestions[2],
      ({ viewCount: v }) => ({
        answer: `조회수가 가장 높은 영상은 {{title:${v.max.id}}}로 {{views:${v.max.id}}}회입니다. 정보 없음 ${v.nullExcluded}개를 뺀 ${v.total - v.nullExcluded}개 중 최댓값입니다.`,
        expected: [v.max.value],
      }),
    ],
    [
      statsQuestions[3],
      ({ likeCount: l }) => ({
        answer: `선택한 영상의 좋아요 평균은 ${fmt(l.average)}개입니다. 대상 ${l.total}개 중 정보 없음 ${l.nullExcluded}개를 빼고 합계 ${fmt(l.sum)}개를 나눈 값이며 0개인 영상도 포함했습니다.`,
        expected: [l.average],
      }),
    ],
  ];
  for (const [question, mock] of cases) {
    const input = buildChatInput(question, context, { source: 'search' }, NOW);
    const payload = JSON.parse(input.prompt);
    assert.equal(payload.mode, 'stats', question);
    assert.ok(payload.serverStats.aggregates.viewCount.average > 0);
    assert.doesNotMatch(input.systemInstruction, /세 섹션을 이 순서로|\[콘텐츠 제안\] 작성법/);
    assert.match(input.systemInstruction, /첫 문장은 요청한 값을 serverStats\.aggregates/);
    assert.match(input.systemInstruction, /\{\{daily:영상ID\}\}/);
    assert.ok(payload.responseChecks.firstSentence && !payload.responseChecks.proposals);
    const { answer, expected } = mock(payload.serverStats.aggregates);
    const rendered = renderChatReferences(answer, context, NOW);
    assert.ok(firstSentenceHas(rendered, expected), `첫 문장 값: ${firstSentence(rendered)}`);
    assert.equal(hasSections(rendered), false);
    assert.deepEqual(ungroundedNumbers(rendered, payload), [], rendered);
  }

  // 4) 숫자 근거 검사 자체: 지어낸 값·어림값은 잡고, 제목·날짜 속 숫자는 무시
  const payload = JSON.parse(buildChatInput(statsQuestions[0], context, {}, NOW).prompt);
  const avg = payload.serverStats.aggregates.viewCount.average;
  assert.deepEqual(ungroundedNumbers(`평균 조회수는 ${fmt(avg + 1)}회입니다.`, payload), [avg + 1]);
  assert.deepEqual(ungroundedNumbers('평균은 약 812,000회입니다.', payload), [812_000]);
  assert.deepEqual(
    ungroundedNumbers(`${videos[0].title}는 2026-10-05 업로드, 2026년 기준입니다.`, payload),
    [],
  );
  assert.ok(!firstSentenceHas(`[핵심 요약]\n평균은 ${fmt(avg)}회`, [avg]));
  console.log(
    'test-chat-stats-mode: ok (stats/analysis 판별, aggregates 입력, 3단 양식 분리, 첫 문장 값, 숫자 근거 검사)',
  );
} finally {
  await vite.close();
}
