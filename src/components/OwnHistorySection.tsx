import Reveal from './Reveal';
import HelpTip from './HelpTip';
import { formatCount } from '../lib/format';
import { historyVerdict } from '../lib/own-history';
import type { OwnHistory } from '../types/trend';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });

/**
 * 검색어 대시보드 맨 위: 내 검색어가 자기 평소보다 오르는지 한 문장 판정과 날짜별 하루 조회수 증가 막대.
 * 인기 차트(대부분 다른 분야)와의 비교는 그 아래 참고 정보로 둔다.
 */
export default function OwnHistorySection({ history }: { history: OwnHistory }) {
  const verdict = historyVerdict(history);
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
