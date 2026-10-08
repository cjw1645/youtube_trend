import { useMemo, useState } from 'react';
import DashSection from './DashSection';
import { videoKeywords, LENGTH_BUCKETS } from '../lib/stats';
import {
  BASELINE_KINDS,
  type BaselineKind,
  type Comparison,
  type ShareChange,
  type StoredVideo,
  type TrendResult,
} from '../types/trend';

const KIND_LABEL: Record<BaselineKind, string> = {
  previous: '직전 수집',
  day: '전일 동시간',
  week: '7일 전',
  month: '28일 전',
};
const EVIDENCE_LIMIT = 8;
const CATEGORY_LIMIT = 6;

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const pct = (share: number) => `${(share * 100).toFixed(share > 0 && share < 0.1 ? 1 : 0)}%`;
const gap = (minutes: number) =>
  minutes >= 1440
    ? `${Math.round(minutes / 144) / 10}일`
    : minutes >= 60
      ? `${Math.round(minutes / 6) / 10}시간`
      : `${minutes}분`;

/** 퍼센트포인트 변화. 기준 값이 없으면 null이라 표시하지 않는다. */
function Delta({ change }: { change: ShareChange }) {
  if (change.deltaPp === null) return <span className="trend-delta">—</span>;
  const value = Math.round(change.deltaPp * 10) / 10;
  if (value === 0) return <span className="trend-delta">변화 없음</span>;
  return (
    <span className={`trend-delta ${value > 0 ? 'is-up' : 'is-down'}`}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value).toFixed(1)}%p
    </span>
  );
}

function Sparkline({ points }: { points: { scheduledFor: string; videoCount: number | null }[] }) {
  const max = Math.max(1, ...points.map((p) => p.videoCount ?? 0));
  const w = 120;
  const h = 24;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * w : w / 2);
  const y = (v: number) => h - 2 - (v / max) * (h - 4);
  // 값이 없는 시점(null)에서는 선을 끊는다. 0으로 이어 그리지 않는다.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.videoCount === null) {
      if (current.length) segments.push(current.join(' '));
      current = [];
    } else current.push(`${x(i).toFixed(1)},${y(p.videoCount).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(' '));
  return (
    <svg className="trend-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {segments.map((segment) =>
        segment.includes(' ') ? (
          <polyline
            key={segment}
            points={segment}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        ) : (
          <circle
            key={segment}
            cx={segment.split(',')[0]}
            cy={segment.split(',')[1]}
            r="1.8"
            fill="currentColor"
          />
        ),
      )}
    </svg>
  );
}

interface Props {
  trend: TrendResult;
  /** 같은 실행의 저장된 영상. 있으면 키워드별 근거 영상을 보여준다. */
  videos: readonly StoredVideo[] | null;
  categoryNames: ReadonlyMap<string, string>;
  /** 예: 「공통 인기 목록」, 「'고양이' 검색 결과」 */
  scope: string;
  onSelectVideo: (videoId: string) => void;
  onSearchKeyword?: (keyword: string) => void;
  /** AI 대상으로 상위 20개를 가져온다. 이미 선택한 대상이 있으면 'kept'를 돌려준다. */
  onImport?: (videos: readonly StoredVideo[]) => 'set' | 'kept';
}

export default function TrendPanel({
  trend,
  videos,
  categoryNames,
  scope,
  onSelectVideo,
  onSearchKeyword,
  onImport,
}: Props) {
  const firstAvailable = trend.comparisons.find((c) => c.available)?.kind ?? 'previous';
  const [kind, setKind] = useState<BaselineKind>(firstAvailable);
  const [open, setOpen] = useState<string | null>(null);
  const [imported, setImported] = useState<'set' | 'kept' | null>(null);
  const comparison: Comparison =
    trend.comparisons.find((c) => c.kind === kind) ?? trend.comparisons[0];
  const { current } = trend;
  const nameOf = (id: string) => categoryNames.get(id) ?? '카테고리 정보 없음';

  const keywords = comparison.available ? comparison.keywords : null;
  const keywordRows = keywords ?? current.keywords ?? [];
  const evidence = useMemo(() => {
    if (!open || !videos) return [];
    return videos.filter((v) => videoKeywords({ title: v.title, tags: v.tags }).has(open));
  }, [open, videos]);
  const categories = (comparison.available ? comparison.categories : current.categories) ?? [];

  return (
    <div className="trend-panel">
      <p className="trend-scope">
        {scope} {current.itemCount}개 · {when(current.scheduledFor)} 수집 ·{' '}
        {new Date(current.expiresAt).toLocaleDateString('ko-KR')}까지 보관
        {current.smallSample && ' · 표본이 적어 비율 해석에 주의'}
      </p>
      <p className="trend-note">
        키워드·카테고리는 이 목록 안의 영상 비율이며 YouTube 전체 검색량·시청자 관심도가 아닙니다.
      </p>

      <nav className="dash-tabs" aria-label="비교 기준">
        {BASELINE_KINDS.map((item) => {
          const found = trend.comparisons.find((c) => c.kind === item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={kind === item}
              disabled={!found?.available}
              title={found?.available ? undefined : '해당 시점의 완료된 수집이 아직 없습니다'}
              onClick={() => setKind(item)}
            >
              {KIND_LABEL[item]}
            </button>
          );
        })}
      </nav>
      {comparison.available && comparison.baseline ? (
        <p className="trend-note">
          기준: {when(comparison.baseline.scheduledFor)} 수집 · 영상 {comparison.baseline.itemCount}
          개 · 현재와 {gap(comparison.baseline.gapMinutes)} 간격
          {comparison.smallSample && ' · 표본이 적어 참고용'}
        </p>
      ) : (
        <p className="trend-note" role="status">
          {KIND_LABEL[kind]} 기준으로 비교할 완료된 수집이 없습니다. 수집이 더 쌓이면 비교할 수
          있고, 보존 기간이 지난 수집은 비교할 수 없습니다. 아래는 현재 목록만의 집계입니다.
        </p>
      )}

      {comparison.available && comparison.videos && (
        <DashSection
          title="목록 변화"
          basis="같은 영상 기준 · 영상 ID로 비교"
          className="trend-videos"
        >
          <dl className="trend-tiles">
            <div>
              <dt>그대로 남음</dt>
              <dd>
                {comparison.videos.retained}개
                {comparison.videos.retainedShare !== null && (
                  <small> · 현재 목록의 {pct(comparison.videos.retainedShare)}</small>
                )}
              </dd>
            </div>
            <div>
              <dt>새로 들어옴</dt>
              <dd>{comparison.videos.entered}개</dd>
            </div>
            <div>
              <dt>빠짐</dt>
              <dd>{comparison.videos.left}개</dd>
            </div>
          </dl>
        </DashSection>
      )}

      <DashSection
        title="키워드"
        basis={`제목·태그에 나온 영상 수(영상당 1회) · ${current.itemCount}개 중 비율`}
        className="trend-keywords"
      >
        {comparison.available && comparison.keywords === null && (
          <p className="dash-empty">기준 수집에는 키워드 집계가 없어 변화를 비교할 수 없습니다.</p>
        )}
        {current.keywords === null ? (
          <p className="dash-empty">이 수집에는 키워드 집계가 없습니다.</p>
        ) : keywordRows.length ? (
          <ol className="trend-list">
            {keywordRows.map((row) => {
              const expanded = open === row.keyword;
              return (
                <li key={row.keyword}>
                  <div className="trend-row">
                    <button
                      type="button"
                      className="trend-name"
                      aria-expanded={expanded}
                      disabled={!videos}
                      onClick={() => setOpen(expanded ? null : row.keyword)}
                    >
                      {row.keyword}
                    </button>
                    <span className="trend-count">
                      {row.count}개 · {pct(row.share)}
                      <small> · 채널 {row.channels}곳</small>
                    </span>
                    {comparison.available && keywords ? (
                      row.belowBaseline ? (
                        <span className="trend-delta is-up">기준 시점엔 2개 미만</span>
                      ) : (
                        <Delta change={row} />
                      )
                    ) : (
                      <span />
                    )}
                    {onSearchKeyword && (
                      <button
                        type="button"
                        className="trend-link"
                        onClick={() => onSearchKeyword(row.keyword)}
                        aria-label={`${row.keyword} 영상 검색`}
                      >
                        검색
                      </button>
                    )}
                  </div>
                  {expanded && (
                    <ul className="trend-evidence" aria-label={`${row.keyword} 근거 영상`}>
                      {evidence.slice(0, EVIDENCE_LIMIT).map((video) => (
                        <li key={video.video_id}>
                          <button type="button" onClick={() => onSelectVideo(video.video_id)}>
                            <span className="trend-pos">{video.position}</span>
                            <span>{video.title}</span>
                          </button>
                        </li>
                      ))}
                      {evidence.length > EVIDENCE_LIMIT && (
                        <li className="trend-more">
                          외 {evidence.length - EVIDENCE_LIMIT}개 · 목록 순서는 API 반환 순서입니다
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="dash-empty">{keywordEmptyText(current.itemCount)}</p>
        )}
      </DashSection>

      <div className="dash-detail">
        <DashSection
          title="카테고리 비중"
          basis="영상 수 기준 · API 제공 카테고리"
          className="trend-categories"
        >
          {categories.length ? (
            <ol className="trend-list">
              {categories.slice(0, CATEGORY_LIMIT).map((row) => (
                <li key={row.categoryId} className="trend-row is-compact">
                  <span className="trend-name-static">{nameOf(row.categoryId)}</span>
                  <span className="trend-count">
                    {row.count}개 · {pct(row.share)}
                  </span>
                  {comparison.available ? <Delta change={row} /> : <span />}
                </li>
              ))}
            </ol>
          ) : (
            <p className="dash-empty">카테고리 정보가 있는 영상이 없습니다.</p>
          )}
        </DashSection>
        <DashSection
          title="영상 길이 구간"
          basis="길이를 아는 영상 중 비율 · 쇼츠 여부는 API에 없음"
          className="trend-lengths"
        >
          <ol className="trend-list">
            {(comparison.available && comparison.lengths
              ? comparison.lengths
              : LENGTH_BUCKETS.map((bucket) => ({
                  key: bucket.key,
                  count: current.lengths.counts[bucket.key],
                  share: current.lengths.known
                    ? current.lengths.counts[bucket.key] / current.lengths.known
                    : 0,
                  baseCount: null,
                  baseShare: null,
                  deltaPp: null,
                }))
            ).map((row) => (
              <li key={row.key} className="trend-row is-compact">
                <span className="trend-name-static">
                  {LENGTH_BUCKETS.find((bucket) => bucket.key === row.key)?.label}
                </span>
                <span className="trend-count">
                  {row.count}개 · {pct(row.share)}
                </span>
                {comparison.available ? <Delta change={row} /> : <span />}
              </li>
            ))}
          </ol>
          {current.lengths.unknown > 0 && (
            <p className="dash-empty">
              길이를 알 수 없는 영상 {current.lengths.unknown}개는 제외했습니다.
            </p>
          )}
        </DashSection>
      </div>

      {trend.series.length > 0 && trend.series[0].points.length > 1 && (
        <DashSection
          title="최근 7일 키워드 추이"
          basis="수집 시점별 영상 수 · 끊긴 선은 기준 미만(2개 미만)이거나 수집 없음"
          className="trend-series"
        >
          <ul className="trend-list">
            {trend.series.map((item) => (
              <li key={item.keyword} className="trend-row is-compact">
                <span className="trend-name-static">{item.keyword}</span>
                <Sparkline points={item.points} />
                <span className="trend-count">
                  {item.points.length}회 수집 · 최근 {item.points.at(-1)?.videoCount ?? '—'}개
                </span>
              </li>
            ))}
          </ul>
        </DashSection>
      )}

      {onImport && videos && videos.length > 0 && (
        <div className="trend-import">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setImported(onImport(videos))}
          >
            이 목록 상위 20개를 AI 대상으로 가져오기
          </button>
          {imported && (
            <p role="status" className="trend-note">
              {imported === 'set'
                ? 'AI 대화의 분석 대상으로 가져왔습니다. 질문은 AI 대화 화면에서 전송합니다.'
                : '이미 선택한 분석 대상이 있어 유지했습니다. 바꾸려면 AI 대화 화면에서 대상을 바꾸세요.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function keywordEmptyText(count: number) {
  return count < 10
    ? '표본이 적어 반복되는 키워드를 찾기 어렵습니다.'
    : '3개 이상 영상에 나온 키워드가 없습니다.';
}
