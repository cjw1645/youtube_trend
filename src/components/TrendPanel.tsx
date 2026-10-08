import { useMemo, useState } from 'react';
import DashSection from './DashSection';
import WordCloud from './WordCloud';
import Spotlight, { type HotItem, type HotVideo } from './Spotlight';
import { CHART_COLORS, ColumnChart, DonutChart, LineChart, StackBar } from './charts';
import { formatCount } from '../lib/format';
import { videoKeywords, LENGTH_BUCKETS } from '../lib/stats';
import {
  BASELINE_KINDS,
  type BaselineKind,
  type Comparison,
  type KeywordChange,
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
const SPOT_ORDER: BaselineKind[] = ['week', 'day', 'previous', 'month'];
const DAY_MS = 86_400_000;
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
  /** 위쪽에 이미 하이라이트가 있는 화면에서는 false */
  showSpotlight?: boolean;
}

export default function TrendPanel({
  trend,
  videos,
  categoryNames,
  scope,
  onSelectVideo,
  onSearchKeyword,
  onImport,
  showSpotlight = true,
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
  const picked = keywordRows.find((row) => row.keyword === open) ?? null;
  const categories = (comparison.available ? comparison.categories : current.categories) ?? [];

  const spot = useMemo(() => {
    const base = SPOT_ORDER.map((k) => trend.comparisons.find((c) => c.kind === k)).find(
      (c) => c?.available,
    );
    const baseName = base ? KIND_LABEL[base.kind] : null;
    const end = Date.parse(current.scheduledFor);
    const list = videos ?? [];
    const recent = list.filter(
      (v) => v.view_count !== null && Date.parse(v.published_at) >= end - 7 * DAY_MS,
    );
    const pool = recent.length ? recent : list.filter((v) => v.view_count !== null);
    const best = pool.reduce<StoredVideo | null>(
      (top, v) => (!top || (v.view_count ?? 0) > (top.view_count ?? 0) ? v : top),
      null,
    );
    const video: HotVideo | null = best
      ? {
          id: best.video_id,
          title: best.title,
          thumbnail: best.thumbnail_url,
          channel: best.channel_title,
          metric: `조회수 ${formatCount(best.view_count ?? 0)}`,
          note: recent.length
            ? '최근 7일 안에 올라온 영상 중 1위'
            : '목록 전체 1위 · 최근 7일 업로드 없음',
        }
      : null;
    const pick = <T extends ShareChange & { belowBaseline?: boolean }>(
      rows: readonly T[],
      name: (row: T) => string,
    ): HotItem | null => {
      if (!rows.length) return null;
      const rising = rows
        .filter((r) => r.deltaPp !== null && r.deltaPp > 0 && !r.belowBaseline)
        .sort((a, b) => (b.deltaPp ?? 0) - (a.deltaPp ?? 0))[0];
      if (rising && baseName)
        return {
          label: name(rising),
          metric: `▲ ${(Math.round((rising.deltaPp ?? 0) * 10) / 10).toFixed(1)}%p`,
          note: `${baseName}보다 비중이 가장 크게 늘었어요 · 현재 ${rising.count}개(${pct(rising.share)})`,
          rising: true,
        };
      const top = rows[0];
      return {
        label: name(top),
        metric: pct(top.share),
        note: `이 목록의 영상 ${top.count}개에 등장${baseName ? '' : ' · 비교할 이전 수집 없음'}`,
      };
    };
    const kwRows: KeywordChange[] = base?.keywords ?? current.keywords ?? [];
    const catRows = base?.categories ?? current.categories ?? [];
    return {
      video,
      tag: pick(kwRows, (r) => `#${r.keyword}`),
      field: pick(catRows, (r) => nameOf(r.categoryId)),
      daily: Array.from({ length: 7 }, (_, i) => {
        const day = new Date(end - (6 - i) * DAY_MS);
        const key = day.toDateString();
        return {
          label: `${day.getMonth() + 1}/${day.getDate()}`,
          value: list.filter((v) => new Date(v.published_at).toDateString() === key).length,
        };
      }),
    };
    // nameOf는 categoryNames가 바뀔 때만 달라진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trend, videos, categoryNames]);
  const donut = categories.slice(0, 5).map((row) => ({
    label: nameOf(row.categoryId),
    value: row.count,
  }));
  const rest = categories.slice(5).reduce((acc, row) => acc + row.count, 0);
  if (rest > 0) donut.push({ label: '기타', value: rest });
  const lineSeries = trend.series.slice(0, 5);
  const lineLabels = (lineSeries[0]?.points ?? []).map((point) => {
    const d = new Date(point.scheduledFor);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}시`;
  });
  const hotTag = spot.tag;

  return (
    <div className="trend-panel">
      {showSpotlight && (
        <Spotlight
          title="지금 가장 눈에 띄는 것"
          basis={`${scope} ${current.itemCount}개 · 수집 시점 데이터`}
          video={spot.video}
          tag={
            hotTag && onSearchKeyword
              ? { ...hotTag, onClick: () => onSearchKeyword(hotTag.label.replace(/^#/, '')) }
              : hotTag
          }
          field={spot.field}
          onOpenVideo={onSelectVideo}
        />
      )}
      <div className="chart-grid">
        <DashSection
          title="분야별 비중"
          basis="영상 수 기준 · API 제공 카테고리"
          className="chart-card"
        >
          {donut.length ? (
            <DonutChart
              slices={donut}
              centerLabel={`${current.itemCount}개`}
              centerNote="분석한 영상"
            />
          ) : (
            <p className="dash-empty">카테고리 정보가 있는 영상이 없습니다.</p>
          )}
        </DashSection>
        <DashSection
          title="최근 7일 업로드 수"
          basis="이 목록 영상의 게시일 기준 · 날짜별 영상 수"
          className="chart-card"
        >
          {videos?.length ? (
            <ColumnChart items={spot.daily} unit="개" />
          ) : (
            <p className="dash-empty">영상 목록이 없어 그릴 수 없습니다.</p>
          )}
        </DashSection>
        <DashSection title="영상 길이 구성" basis="길이를 아는 영상 중 비율" className="chart-card">
          <StackBar
            parts={LENGTH_BUCKETS.map((bucket) => ({
              label: bucket.label,
              value: current.lengths.counts[bucket.key],
            }))}
          />
          <ul className="legend">
            {LENGTH_BUCKETS.map((bucket, index) => (
              <li key={bucket.key}>
                <span
                  className="legend-dot"
                  style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
                  aria-hidden="true"
                />
                <span className="legend-name">{bucket.label}</span>
                <span className="legend-value">
                  {current.lengths.known
                    ? Math.round((current.lengths.counts[bucket.key] / current.lengths.known) * 100)
                    : 0}
                  %
                </span>
              </li>
            ))}
          </ul>
        </DashSection>
      </div>
      <DashSection
        title="키워드 추이"
        basis="수집 시점별로 그 키워드가 나온 영상 수 · 선이 끊기면 기준 미만이거나 수집 없음"
        className="chart-wide"
      >
        {lineSeries.length > 0 && lineLabels.length > 1 ? (
          <LineChart
            series={lineSeries.map((item) => ({
              label: item.keyword,
              values: item.points.map((point) => point.videoCount),
            }))}
            labels={lineLabels}
            unit="개"
          />
        ) : (
          <p className="dash-empty" role="status">
            수집이 2회 이상 쌓이면 키워드별 추이 그래프가 이곳에 나타납니다.
          </p>
        )}
      </DashSection>
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
          <>
            <WordCloud
              words={keywordRows.map((row) => ({
                key: row.keyword,
                label: row.keyword,
                weight: row.count,
                title: `${row.keyword} · 영상 ${row.count}개 · ${pct(row.share)}`,
                rising:
                  comparison.available && keywords && !row.belowBaseline && row.deltaPp
                    ? row.deltaPp > 0
                    : null,
              }))}
              selected={open}
              onSelect={(key) => setOpen(open === key ? null : key)}
            />
            {picked ? (
              <div className="cloud-detail" role="region" aria-label={`${picked.keyword} 상세`}>
                <p className="cloud-detail-head">
                  <strong>{picked.keyword}</strong>
                  <span>
                    영상 {picked.count}개 · {pct(picked.share)} · 채널 {picked.channels}곳
                  </span>
                  {comparison.available && keywords ? (
                    picked.belowBaseline ? (
                      <span className="trend-delta is-up">기준 시점엔 2개 미만</span>
                    ) : (
                      <Delta change={picked} />
                    )
                  ) : null}
                  {onSearchKeyword && (
                    <button
                      type="button"
                      className="trend-link"
                      onClick={() => onSearchKeyword(picked.keyword)}
                    >
                      이 키워드로 검색
                    </button>
                  )}
                </p>
                {videos ? (
                  <ul className="trend-evidence" aria-label={`${picked.keyword} 근거 영상`}>
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
                ) : null}
              </div>
            ) : (
              <p className="cloud-hint">단어를 누르면 근거 영상과 변화를 볼 수 있어요.</p>
            )}
          </>
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
