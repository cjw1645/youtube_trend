import { useState } from 'react';
import DashSection from './DashSection';
import Reveal from './Reveal';
import HelpTip from './HelpTip';
import WordCloud from './WordCloud';
import { useReveal } from '../hooks/useReveal';
import { formatCount } from '../lib/format';
import type {
  CompareAgeBand,
  CompareEngagementRow,
  CompareKeywordRow,
  PopularCompare,
} from '../types/trend';

type Available = Extract<PopularCompare, { available: true }>;

const when = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const pct = (share: number | null) =>
  share === null ? '—' : `${(share * 100).toFixed(share > 0 && share < 0.1 ? 1 : 0)}%`;
const pp = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}%p`;
/** 배율: 10배 미만은 소수 1자리, 그 이상은 정수 */
const times = (ratio: number) => `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}배`;
/** 인기 차트 대비 수치. 1배 미만은 「0.0배」 대신 퍼센트로 보여준다. */
const ratioText = (ratio: number) =>
  ratio >= 1 ? times(ratio) : ratio < 0.01 ? '1% 미만' : `${Math.round(ratio * 100)}%`;
/** 하루 조회수 증가. 조회수 정정으로 줄어든 경우도 부호를 그대로 보인다. */
const gainText = (value: number | null | undefined) =>
  value == null ? '정보 없음' : `${value < 0 ? '−' : '+'}${formatCount(Math.abs(value))}`;

/** 하루 조회수 증가를 비교할 수 없을 때의 이유. 비교할 수 있으면 null */
export function gainUnavailableReason(compare: Available): string | null {
  const [mine, all] = compare.engagement;
  if (mine?.medianDailyGain != null && all?.medianDailyGain != null) return null;
  // 새 칸이 없는 이전 서버 응답도 「이전 수집 없음」으로 처리한다.
  if (!compare.gainBasis?.slotPrev)
    return '약 24시간 전 검색 수집이 없어 조회수 증가는 다음 수집부터 비교합니다';
  if (!compare.gainBasis?.popularPrev)
    return '약 24시간 전 인기 차트 수집이 없어 조회수 증가를 비교하지 못했습니다';
  return '두 번의 수집에 모두 있는 영상이 없어 조회수 증가를 비교하지 못했습니다';
}

interface Props {
  compare: PopularCompare;
  categoryNames: ReadonlyMap<string, string>;
  onSearchKeyword: (keyword: string) => void;
}

/** 하루 증가가 없을 때 판정에 쓸 나이대: 배율이 있는 구간 중 양쪽 표본이 가장 큰 곳 */
function verdictBand(compare: Available): CompareAgeBand | null {
  const bands = (compare.ageBands ?? []).filter((band) => band.ratio !== null);
  return (
    bands.sort(
      (a, b) => Math.min(b.slotVideos, b.popularVideos) - Math.min(a.slotVideos, a.popularVideos),
    )[0] ?? null
  );
}

/** 배율을 「약 N배 많습니다 / 약 N% 수준입니다 / 비슷합니다」 중 하나로 말한다. 주어는 받침 없는 말(증가·조회수)만 쓴다. */
const comparePhrase = (subject: string, ratio: number) =>
  ratio >= 1.2
    ? `${subject}가 인기 차트보다 약 ${times(ratio)} 많습니다`
    : ratio <= 0.83
      ? `${subject}는 인기 차트의 약 ${ratioText(ratio)} 수준입니다`
      : `${subject}는 인기 차트와 비슷합니다`;

/**
 * 내 검색 결과가 인기 차트 전체·핫 키워드 묶음과 비교해 어느 정도인지 한 문장으로 만든다.
 * 누적 조회수는 오래된 영상일수록 커서 그대로 비교하지 않는다. 약 24시간 전 수집 대비 하루 조회수 증가가 있으면 그것을,
 * 없으면(검색어 첫 수집 등) 업로드 후 기간이 같은 영상끼리의 누적 조회수를 쓴다.
 */
export function compareVerdict(compare: Available): {
  headline: string;
  detail: string;
  ratio: number | null;
  basis: 'gain' | 'age' | null;
  band: CompareAgeBand | null;
} {
  const [mine, all, ...hot] = compare.engagement;
  const mineGain = mine?.medianDailyGain ?? null;
  const allGain = all?.medianDailyGain ?? null;
  const ratio =
    mineGain !== null && allGain !== null && allGain > 0 && mineGain >= 0
      ? mineGain / allGain
      : null;
  const query = `‘${compare.query}’`;
  const band = ratio === null ? verdictBand(compare) : null;
  const headline =
    ratio !== null
      ? `${query} 검색 결과의 ${comparePhrase('하루 조회수 증가', ratio)}`
      : band?.ratio != null
        ? `${query} 검색 결과를 업로드 ${band.label} 영상끼리 보면 ${comparePhrase('누적 조회수', band.ratio)}`
        : `${query} 검색 결과를 인기 차트와 비교했습니다`;
  const comparable = hot.filter((row) => row.medianDailyGain !== null);
  const above =
    mineGain !== null
      ? comparable.filter((row) => mineGain > (row.medianDailyGain ?? 0)).length
      : 0;
  const parts = [
    ratio !== null && comparable.length
      ? `하루 조회수 증가 기준 인기 차트 핫 키워드 ${comparable.length}개 중 ${above}개보다 많고`
      : null,
    ratio === null ? gainUnavailableReason(compare) : null,
    `인기 차트에 든 영상은 ${compare.videos.count}개입니다`,
  ].filter(Boolean);
  return {
    headline,
    detail: parts.join(', '),
    ratio: ratio ?? band?.ratio ?? null,
    basis: ratio !== null ? 'gain' : band ? 'age' : null,
    band,
  };
}

function StatCard({
  label,
  value,
  note,
  primary = false,
  delay,
}: {
  label: string;
  value: string;
  note: string;
  primary?: boolean;
  delay: number;
}) {
  return (
    <Reveal className={`compare-card ${primary ? 'is-primary' : ''}`} delay={delay}>
      <dt>{label}</dt>
      <dd>
        <span className="compare-value">{value}</span>
        <span className="compare-note">{note}</span>
      </dd>
    </Reveal>
  );
}

/** 단어 구름 한 칸. 겹치는 단어는 같은 색 윤곽으로 두 구름에서 모두 표시된다. */
function CloudCard({
  title,
  caption,
  rows,
  weight,
  shared,
  onSearchKeyword,
  empty,
}: {
  title: string;
  caption: string;
  rows: readonly CompareKeywordRow[];
  weight: (row: CompareKeywordRow) => number;
  shared: ReadonlySet<string>;
  onSearchKeyword: (keyword: string) => void;
  empty: string;
}) {
  return (
    <Reveal className="compare-cloud">
      <h3>{title}</h3>
      <p className="compare-caption">{caption}</p>
      {rows.length ? (
        <WordCloud
          words={rows.map((row) => ({
            key: row.keyword,
            label: row.keyword,
            weight: weight(row),
            shared: shared.has(row.keyword),
            title: `${row.keyword} · 검색 결과 ${pct(row.slotShare)}(영상 ${row.slotCount ?? 0}개) · 인기 차트 ${pct(row.popularShare)}(영상 ${row.popularCount ?? 0}개) · 누르면 검색`,
          }))}
          selected={null}
          onSelect={onSearchKeyword}
        />
      ) : (
        <p className="dash-empty">{empty}</p>
      )}
    </Reveal>
  );
}

/**
 * 내 검색어를 인기 차트와 비교하는 맨 위 블록: 판정 문장, 큰 수치 카드, 인기 차트 핫 키워드와 내 검색 키워드의
 * 단어 구름 두 개(겹치는 단어는 같은 색)와 겹치는 키워드의 증감.
 */
export default function PopularCompareSection({ compare, categoryNames, onSearchKeyword }: Props) {
  if (!compare.available)
    return (
      <DashSection
        title="인기 차트와 비교"
        basis="같은 시각 근처의 인기 차트 수집과 비교"
        className="popular-compare"
      >
        <p className="dash-empty" role="status">
          비교할 인기 차트 수집이 없습니다. 이 검색어의 수집 시각({when(compare.slot.scheduledFor)})
          전후 26시간 안에 완료된 인기 차트 수집이 없습니다.
        </p>
      </DashSection>
    );

  const { exposure, keywords, videos, categories } = compare;
  const verdict = compareVerdict(compare);
  const best = [...exposure.tokens]
    .filter((token) => token.popularCount !== null)
    .sort((a, b) => (b.popularCount ?? 0) - (a.popularCount ?? 0))[0];
  const topCategory = categories[0];
  const categoryName = topCategory
    ? (categoryNames.get(topCategory.categoryId) ?? '카테고리 정보 없음')
    : null;
  const sharedSet = new Set(keywords.common.map((row) => row.keyword));
  const popularSide = [...keywords.common, ...keywords.popularOnly];
  const slotSide = [...keywords.common, ...keywords.slotOnly];
  const aggregateFailed = compare.slotKeywordCount === 0;
  const [mine, all] = compare.engagement;

  return (
    <section className="popular-compare compare-top" aria-label="인기 차트와 비교">
      <Reveal className="compare-hero">
        <p className="compare-eyebrow">
          <span className="live-dot" aria-hidden="true" />
          인기 차트와 비교
          <HelpTip label="비교 기준 보기">
            검색 결과 {compare.slot.itemCount}개({when(compare.slot.scheduledFor)} 수집) vs 인기
            차트 {compare.popular.itemCount}개({when(compare.popular.scheduledFor)} 수집) · 표본
            크기가 달라 비율로 비교합니다
          </HelpTip>
        </p>
        <h2 className="compare-verdict">{verdict.headline}</h2>
        <p className="compare-detail">{verdict.detail}</p>
      </Reveal>

      <dl className="compare-cards">
        <StatCard
          primary
          delay={0}
          label={
            verdict.basis === 'age' && verdict.band
              ? `누적 조회수 · 업로드 ${verdict.band.label} 영상끼리`
              : '하루 조회수 증가 · 인기 차트 대비'
          }
          value={verdict.ratio === null ? '—' : ratioText(verdict.ratio)}
          note={
            verdict.basis === 'gain'
              ? `중앙값 ${gainText(mine?.medianDailyGain)} vs ${gainText(all?.medianDailyGain)}`
              : verdict.basis === 'age' && verdict.band
                ? `중앙값 ${formatCount(verdict.band.slotMedianViews)} vs ${formatCount(verdict.band.popularMedianViews)}`
                : '어제 같은 시각 수집이 있어야 계산합니다'
          }
        />
        <StatCard
          delay={80}
          label="인기 차트에 든 영상"
          value={`${videos.count}개`}
          note={`검색 결과의 ${pct(videos.share)}${videos.bestPosition !== null ? ` · 최고 ${videos.bestPosition}위` : ''}`}
        />
        <StatCard
          delay={160}
          label="인기 차트 키워드 노출"
          value={exposure.noTokens ? '—' : best ? `${best.popularCount}개 영상` : '없음'}
          note={
            exposure.noTokens
              ? '비교할 키워드 토큰이 없음'
              : best
                ? `인기 키워드 ${best.rank}위 · ‘${best.keyword}’`
                : '집계에 나오지 않음(영상 2개 미만 포함)'
          }
        />
        <StatCard
          delay={240}
          label="분야 차이가 가장 큰 곳"
          value={topCategory ? pp(topCategory.deltaPp) : '—'}
          note={
            topCategory
              ? `${categoryName} · 검색 ${pct(topCategory.slotShare)} · 인기 ${pct(topCategory.popularShare)}`
              : '카테고리 집계 없음'
          }
        />
      </dl>

      {aggregateFailed && (
        <p role="alert" className="trend-warning">
          이 검색어는 키워드 집계에 실패했습니다(2개 이상 영상에 함께 나온 키워드가 없음). 다른
          키워드로 변경해 주세요.
        </p>
      )}

      <div className="compare-clouds">
        <CloudCard
          title="지금 인기 차트의 핫 키워드"
          caption={`인기 차트 ${compare.popular.itemCount}개 안에서 많이 나온 단어 · 초록 윤곽은 내 검색에도 있는 단어`}
          rows={popularSide}
          weight={(row) => row.popularCount ?? 0}
          shared={sharedSet}
          onSearchKeyword={onSearchKeyword}
          empty="인기 차트의 키워드 집계가 없습니다."
        />
        <CloudCard
          title={`‘${compare.query}’ 검색 결과의 키워드`}
          caption={`검색 결과 ${compare.slot.itemCount}개 안에서 많이 나온 단어 · 초록 윤곽은 인기 차트에도 있는 단어`}
          rows={slotSide}
          weight={(row) => row.slotCount ?? 0}
          shared={sharedSet}
          onSearchKeyword={onSearchKeyword}
          empty={
            aggregateFailed
              ? '키워드 집계에 실패해 보여줄 수 없습니다. 다른 키워드로 변경해 주세요.'
              : '2개 이상 영상에 나온 키워드가 없습니다.'
          }
        />
      </div>

      <Reveal className="compare-overlap">
        <h3>겹치는 키워드 {keywords.commonTotal}개</h3>
        {keywords.common.length ? (
          <ul>
            {keywords.common.map((row) => (
              <li key={row.keyword}>
                <button
                  type="button"
                  className="keyword-chip"
                  aria-label={`${row.keyword} 검색 (검색 결과 ${pct(row.slotShare)}, 인기 차트 ${pct(row.popularShare)})`}
                  onClick={() => onSearchKeyword(row.keyword)}
                >
                  {row.keyword}{' '}
                  <span
                    className={`trend-delta ${row.deltaPp !== null && row.deltaPp !== 0 ? (row.deltaPp > 0 ? 'is-up' : 'is-down') : ''}`}
                  >
                    {row.deltaPp !== null && row.deltaPp !== 0
                      ? `${row.deltaPp > 0 ? '▲' : '▼'} ${Math.abs(row.deltaPp).toFixed(1)}%p`
                      : '—'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="dash-empty">
            {aggregateFailed
              ? '키워드 집계에 실패해 비교할 수 없습니다. 다른 키워드로 변경해 주세요.'
              : '겹치는 키워드가 없습니다 — 인기 차트와 다른 흐름의 주제입니다.'}
          </p>
        )}
        <p className="trend-note">
          ▲ 검색 결과에서 더 자주 나옴 · ▼ 인기 차트에서 더 자주 나옴(비율 차이). 키워드 집계는 영상
          2개 이상에 나온 단어만 저장되어, 한쪽에 없다는 것은 0개가 아니라 기준 미만이라는 뜻일 수
          있습니다.
        </p>
      </Reveal>
    </section>
  );
}

type Metric = 'gain' | 'views' | 'likes';
const METRIC_LABEL: Record<Metric, string> = {
  gain: '하루 증가',
  views: '누적 조회수',
  likes: '좋아요',
};
const METRIC_UNIT: Record<Metric, string> = {
  gain: '하루 조회수 증가',
  views: '누적 조회수',
  likes: '좋아요',
};

/**
 * 내 검색 결과와 인기 차트 전체, 인기 차트의 핫 키워드 영상 묶음의 하루 조회수 증가·누적 조회수·좋아요 중앙값 가로 막대.
 * 기본은 하루 증가(누적은 영상 나이에 좌우됨). 보이는 순간 막대가 자라나고, 내 검색 결과 막대만 강조색이다.
 */
function EngagementBars({ rows }: { rows: readonly CompareEngagementRow[] }) {
  const [metric, setMetric] = useState<Metric>('gain');
  const [ref, seen] = useReveal<HTMLDivElement>();
  const valueOf = (row: CompareEngagementRow) =>
    metric === 'gain'
      ? row.medianDailyGain
      : metric === 'views'
        ? row.medianViews
        : row.medianLikes;
  const max = Math.max(1, ...rows.map((row) => valueOf(row) ?? 0));
  const unit = METRIC_UNIT[metric];
  return (
    <div className="engagement" ref={ref}>
      <div className="engagement-head">
        <h3 className="compare-sub">영상 {unit} 비교 · 중앙값</h3>
        <div className="engagement-toggle" role="group" aria-label="비교 지표">
          {(['gain', 'views', 'likes'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {METRIC_LABEL[key]}
            </button>
          ))}
        </div>
      </div>
      <ul className="engagement-bars" aria-label={`${unit} 중앙값 비교`}>
        {rows.map((row, index) => {
          const value = valueOf(row);
          const width =
            !seen || value === null || value <= 0 ? 0 : Math.max(2, (value / max) * 100);
          return (
            <li key={`${row.kind}:${row.label}`} className={`is-${row.kind}`}>
              <span className="engagement-label">
                {row.label}
                <small>영상 {metric === 'gain' ? row.gainVideos : row.videos}개</small>
              </span>
              <span className="engagement-track" aria-hidden="true">
                <span
                  className="engagement-fill"
                  style={{ width: `${width}%`, transitionDelay: `${index * 70}ms` }}
                />
              </span>
              <span className="engagement-value">
                {metric === 'gain'
                  ? gainText(value)
                  : value === null
                    ? '정보 없음'
                    : formatCount(value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 업로드 후 기간이 같은 영상끼리의 누적 조회수 중앙값. 표본이 모자란 구간은 배율 대신 「비교 불가」. */
function AgeBands({ bands }: { bands: readonly CompareAgeBand[] }) {
  const views = (value: number | null) => (value === null ? '—' : formatCount(value));
  return (
    <div className="age-bands">
      <div className="title-row">
        <h3 className="compare-sub">업로드 후 기간별 누적 조회수</h3>
        <HelpTip label="기간별 비교 기준 보기">
          같은 기간에 올라온 영상끼리 누적 조회수 중앙값을 비교합니다. 오래된 영상일수록 누적
          조회수가 커지는 차이를 피하기 위한 것이며, 한쪽 영상이 3개 미만이면 배율을 내지 않습니다.
        </HelpTip>
      </div>
      <ul>
        {bands.map((band) => (
          <li key={band.key}>
            <span className="age-band-label">{band.label}</span>
            <span className="age-band-side">
              내 검색 {views(band.slotMedianViews)}
              <small>영상 {band.slotVideos}개</small>
            </span>
            <span className="age-band-side">
              인기 차트 {views(band.popularMedianViews)}
              <small>영상 {band.popularVideos}개</small>
            </span>
            <strong className={`age-band-ratio ${band.ratio === null ? 'is-empty' : ''}`}>
              {band.ratio === null ? '비교 불가' : ratioText(band.ratio)}
            </strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 「지금 가장 눈에 띄는 것」 바로 아래에 놓는 조회수·좋아요 비교 차트. 인기 차트 비교가 없으면 그리지 않는다. */
export function CompareEngagement({ compare }: { compare: PopularCompare }) {
  if (!compare.available) return null;
  return (
    <DashSection
      title="인기 차트와 조회수·좋아요 비교"
      basis="내 검색 결과 · 인기 차트 전체 · 인기 차트 핫 키워드(영상 수 상위 5, 내 검색어 제외) 영상의 중앙값. 하루 증가는 약 24시간 전 수집에도 있던 영상의 조회수 증가를 24시간 기준으로 환산한 값이고, 누적 조회수는 오래된 영상일수록 큽니다. 핫 키워드 묶음은 그 키워드가 제목·태그에 나온 인기 영상들이며 공개되지 않은 값은 제외합니다."
      className="popular-compare compare-engagement"
    >
      <EngagementBars rows={compare.engagement} />
      {gainUnavailableReason(compare) && (
        <p className="trend-note">{gainUnavailableReason(compare)}</p>
      )}
      {(compare.ageBands ?? []).length > 0 && <AgeBands bands={compare.ageBands} />}
    </DashSection>
  );
}
