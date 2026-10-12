import Reveal from './Reveal';
import HelpTip from './HelpTip';
import { formatCount } from '../lib/format';
import { historyVerdict } from '../lib/own-history';
import { videoKeywords } from '../lib/stats/keywords';
import type { KeywordChange, OwnHistory, TrendResult } from '../types/trend';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });

const ageText = (hours: number | null) =>
  hours === null
    ? ''
    : hours < 24
      ? `${Math.max(1, hours)}시간 전 업로드`
      : `${Math.floor(hours / 24)}일 전 업로드`;

/** 이 주제 안에서 비중이 늘어난 키워드. 검색어 자체 단어는 늘 나오므로 뺀다. 전일 동시간, 없으면 직전 수집 기준. */
export function risingKeywords(
  trend: TrendResult | null,
  query: string,
  limit = 6,
): KeywordChange[] {
  if (!trend) return [];
  const base =
    trend.comparisons.find((c) => c.kind === 'day' && c.available) ??
    trend.comparisons.find((c) => c.kind === 'previous' && c.available);
  const own = videoKeywords({ title: query, tags: [] });
  return (base?.keywords ?? [])
    .filter((k) => !own.has(k.keyword) && k.deltaPp !== null && k.deltaPp > 0 && k.count >= 2)
    .sort((a, b) => (b.deltaPp ?? 0) - (a.deltaPp ?? 0))
    .slice(0, limit);
}

/**
 * 검색어 대시보드 맨 위: 내 검색어가 자기 평소보다 오르는지 한 문장 판정, 판정과 상관없이 이 주제 안에서
 * 지금 빠르게 크는 영상·늘어난 키워드, 날짜별 하루 조회수 증가 막대. 인기 차트와의 비교는 그 아래 참고로 둔다.
 */
export default function OwnHistorySection({
  history,
  trend,
  onOpenVideo,
  onSearchKeyword,
}: {
  history: OwnHistory;
  trend: TrendResult | null;
  onOpenVideo: (videoId: string) => void;
  onSearchKeyword: (keyword: string) => void;
}) {
  const verdict = historyVerdict(history);
  const rising = risingKeywords(trend, history.query);
  const days = history.days.slice(-14);
  const max = Math.max(1, ...days.map((d) => d.medianDailyGain ?? 0));
  const usual = history.usual.medianDailyGain;
  return (
    <section className="own-history" aria-label="평소와 비교">
      <Reveal className="compare-hero">
        <p className="compare-eyebrow">
          <span className="live-dot" aria-hidden="true" />내 주제, 평소와 비교
          <HelpTip label="평소 기준 보기">
            같은 검색어를 매일 한 번 수집해, 전날 수집에도 있던 영상의 하루 조회수 증가 중앙값을
            날마다 구합니다. 평소는 최근 수집 직전 최대 7일의 중앙값이며, 1.2배 이상이면 오름,
            0.83배 이하면 내림으로 말합니다. 검색 결과 표본 기준이며 YouTube 전체 검색량이 아닙니다.
          </HelpTip>
        </p>
        <h2 className={`compare-verdict own-verdict is-${verdict.tone}`}>{verdict.headline}</h2>
        <p className="compare-detail">{verdict.detail}</p>
      </Reveal>

      <div className="own-now">
        <Reveal className="own-risers">
          <h3 className="compare-sub">
            이 주제에서 지금 빠르게 크는 영상
            {history.risersAt && <small> · {day(history.risersAt)} 수집, 하루 조회수 증가순</small>}
          </h3>
          {history.risers.length ? (
            <ol>
              {history.risers.map((v, i) => (
                <li key={v.videoId}>
                  <button type="button" onClick={() => onOpenVideo(v.videoId)}>
                    <span className="own-riser-rank">{i + 1}</span>
                    <span className="own-riser-title">{v.title}</span>
                    <span className="own-riser-meta">
                      하루 +{formatCount(Math.round(v.dailyGain))}회
                      {v.ageHours !== null && ` · ${ageText(v.ageHours)}`}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="dash-empty">
              전날 수집과 겹친 영상이 생기면(다음 수집부터) 하루 조회수 증가가 큰 영상을 보여
              드립니다.
            </p>
          )}
        </Reveal>
        <Reveal className="own-rising-keywords">
          <h3 className="compare-sub">이 주제 안에서 어제보다 늘어난 키워드</h3>
          {rising.length ? (
            <ul>
              {rising.map((k) => (
                <li key={k.keyword}>
                  <button
                    type="button"
                    className="keyword-chip"
                    aria-label={`${k.keyword} 검색 (영상 ${k.count}개, 비중 ${(k.deltaPp ?? 0).toFixed(1)}%p 증가)`}
                    onClick={() => onSearchKeyword(k.keyword)}
                  >
                    {k.keyword}{' '}
                    <span className="trend-delta is-up">▲ {(k.deltaPp ?? 0).toFixed(1)}%p</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-empty">
              {trend
                ? '어제보다 비중이 늘어난 키워드가 없습니다.'
                : '전날 수집이 있어야 비교합니다.'}
            </p>
          )}
        </Reveal>
      </div>

      {days.length > 1 && (
        <Reveal className="own-days">
          <h3 className="compare-sub">날짜별 하루 조회수 증가 · 중앙값</h3>
          <ol className="own-bars" aria-label="날짜별 하루 조회수 증가 중앙값">
            {days.map((d, index) => {
              const value = d.medianDailyGain;
              const latest = index === days.length - 1;
              const label = `${day(d.scheduledFor)} · ${
                value === null
                  ? '비교 불가(전날 수집 없음 또는 겹친 영상 부족)'
                  : `+${formatCount(Math.round(value))} (영상 ${d.gainVideos}개)`
              }`;
              return (
                <li key={d.runId} className={latest ? 'is-latest' : undefined} title={label}>
                  <span className="own-bar-track" aria-hidden="true">
                    <span
                      className={`own-bar-fill ${value === null ? 'is-empty' : ''}`}
                      style={{
                        height: value === null ? '2px' : `${Math.max(4, (value / max) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="own-bar-day">{day(d.scheduledFor)}</span>
                  <span className="sr-only">{label}</span>
                </li>
              );
            })}
          </ol>
          {usual !== null && (
            <p className="trend-note">
              평소(지난 {history.usual.days}일 중앙값) +{formatCount(Math.round(usual))} · 막대에
              마우스를 올리면 날짜별 값을 볼 수 있습니다.
            </p>
          )}
        </Reveal>
      )}
    </section>
  );
}
