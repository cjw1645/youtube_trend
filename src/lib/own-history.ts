// 내 검색어를 「자기 평소」와 비교한다. 인기 차트는 분야가 달라(대부분 게임) 내 주제가 오르는지 말해 주지 못하므로,
// 같은 검색어의 지난 수집들을 기준으로 삼는다. DB는 영상별 원자료만 주고 중앙값·평소·판정은 여기서 계산한다.
import { median } from './stats/metrics.js';
import type { HistoryDay, OwnHistory } from '../types/trend.js';

/** 평소 판정에 필요한 지난 수집 수(하루 1회 수집이라 3일) */
export const HISTORY_MIN_DAYS = 3;
/** 평소로 삼는 최근 수집 수 */
export const HISTORY_BASELINE_DAYS = 7;
/** 하루 증가 중앙값을 믿을 만한 최소 영상 수 */
export const HISTORY_MIN_GAIN_VIDEOS = 5;
/** 「새 영상」 기준: 업로드 후 72시간 미만 */
const FRESH_HOURS = 72;
/** 이만큼 벗어나야 오르거나 내렸다고 말한다 */
const UP = 1.2;
const DOWN = 0.83;

export interface RawHistory {
  query: string;
  runs: {
    runId: number;
    scheduledFor: string;
    itemCount: number;
    prevScheduledFor?: string | null;
    videos: { dailyGain?: number | null; ageHours?: number | null }[];
  }[];
}

function toDay(run: RawHistory['runs'][number]): HistoryDay {
  const gains = run.videos.flatMap((v) => (v.dailyGain == null ? [] : [v.dailyGain]));
  return {
    runId: run.runId,
    scheduledFor: run.scheduledFor,
    itemCount: run.itemCount,
    medianDailyGain: gains.length >= HISTORY_MIN_GAIN_VIDEOS ? median(gains) : null,
    gainVideos: gains.length,
    freshCount: run.videos.filter((v) => v.ageHours != null && v.ageHours < FRESH_HOURS).length,
  };
}

const freshShareOf = (day: HistoryDay) =>
  day.itemCount > 0 ? day.freshCount / day.itemCount : null;

export function buildHistory(raw: RawHistory): OwnHistory | null {
  const days = [...raw.runs]
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))
    .map(toDay);
  const latest = days.at(-1);
  if (!latest) return null;
  const before = days.slice(0, -1);
  const gainBase = before
    .filter((day) => day.medianDailyGain !== null)
    .slice(-HISTORY_BASELINE_DAYS)
    .map((day) => day.medianDailyGain as number);
  const freshBase = before
    .filter((day) => day.itemCount > 0)
    .slice(-HISTORY_BASELINE_DAYS)
    .map((day) => freshShareOf(day) as number);
  const usualGain = gainBase.length >= HISTORY_MIN_DAYS ? median(gainBase) : null;
  const usualFresh = freshBase.length >= HISTORY_MIN_DAYS ? median(freshBase) : null;
  return {
    query: raw.query,
    days,
    latest,
    usual: { medianDailyGain: usualGain, freshShare: usualFresh, days: gainBase.length },
    needed: HISTORY_MIN_DAYS,
    gainRatio:
      usualGain !== null &&
      usualGain > 0 &&
      latest.medianDailyGain !== null &&
      latest.medianDailyGain >= 0
        ? latest.medianDailyGain / usualGain
        : null,
    freshShare: freshShareOf(latest),
  };
}

export type HistoryTone = 'up' | 'down' | 'flat' | 'collecting';

const times = (ratio: number) => `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}배`;
const pct = (share: number) => `${Math.round(share * 100)}%`;

/** 한 문장 판정과 근거 한 줄. 화면(대시보드·홈)과 테스트가 같은 문장을 쓴다. */
export function historyVerdict(history: OwnHistory): {
  tone: HistoryTone;
  headline: string;
  detail: string;
} {
  const query = `‘${history.query}’`;
  const fresh =
    history.freshShare !== null && history.usual.freshShare !== null
      ? `새로 올라온 영상(3일 안) 비중은 ${pct(history.freshShare)}로 평소 ${pct(history.usual.freshShare)}${
          history.freshShare > history.usual.freshShare + 0.05
            ? '보다 많습니다'
            : history.freshShare < history.usual.freshShare - 0.05
              ? '보다 적습니다'
              : '와 비슷합니다'
        }`
      : null;
  if (history.gainRatio === null) {
    const have = history.usual.days;
    return {
      tone: 'collecting',
      headline:
        history.latest.medianDailyGain === null && have >= history.needed
          ? `${query}의 오늘 수집은 전날과 겹친 영상이 적어 평소와 비교하지 못했습니다`
          : `${query}의 평소 기준을 쌓는 중입니다 (${Math.min(have, history.needed)}/${history.needed}일)`,
      detail:
        have >= history.needed
          ? '검색 결과가 하루 사이 크게 바뀌면 같은 영상끼리 비교할 수 없습니다. 다음 수집에서 다시 계산합니다.'
          : `매일 한 번 수집하며, 전날과 비교한 기록이 ${history.needed}일치 모이면 오늘이 평소보다 오르는지 알려 드립니다. 그동안은 아래 인기 차트 비교를 참고하세요.`,
    };
  }
  const ratio = history.gainRatio;
  const tone: HistoryTone = ratio >= UP ? 'up' : ratio <= DOWN ? 'down' : 'flat';
  const headline =
    tone === 'up'
      ? `${query} 영상들이 평소보다 약 ${times(ratio)} 빠르게 조회수를 모으고 있습니다`
      : tone === 'down'
        ? `${query} 영상들의 조회수 증가가 평소의 약 ${pct(ratio)} 수준으로 줄었습니다`
        : `${query} 영상들의 조회수 증가는 평소와 비슷합니다`;
  const gain = (value: number | null) =>
    value === null ? '—' : `+${Math.round(value).toLocaleString('ko-KR')}`;
  const detail = [
    `하루 조회수 증가 중앙값 ${gain(history.latest.medianDailyGain)} (평소 ${gain(history.usual.medianDailyGain)}, 지난 ${history.usual.days}일 기준)`,
    fresh,
  ]
    .filter(Boolean)
    .join(' · ');
  return { tone, headline, detail };
}

/** AI 입력용 요약: 판정 문장과 근거 숫자만 넘긴다(날짜별 원자료는 넘기지 않는다). */
export function summarizeHistory(history: OwnHistory) {
  const verdict = historyVerdict(history);
  return {
    note: '같은 검색어의 지난 수집(평소)과 비교한 값. 하루 조회수 증가는 전날 수집에도 있던 영상 기준 중앙값',
    verdict: verdict.tone,
    headline: verdict.headline,
    latestScheduledFor: history.latest.scheduledFor,
    latestMedianDailyGain: history.latest.medianDailyGain,
    usualMedianDailyGain: history.usual.medianDailyGain,
    usualDays: history.usual.days,
    gainRatio: history.gainRatio === null ? null : Math.round(history.gainRatio * 100) / 100,
    freshSharePct: history.freshShare === null ? null : Math.round(history.freshShare * 100),
    usualFreshSharePct:
      history.usual.freshShare === null ? null : Math.round(history.usual.freshShare * 100),
  };
}
