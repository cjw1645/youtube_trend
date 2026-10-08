import { useState } from 'react';
import DashSection from './DashSection';
import { formatCount } from '../lib/format';
import type {
  CompareCategoryRow,
  CompareEngagementRow,
  CompareKeywordRow,
  PopularCompare,
} from '../types/trend';

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

interface Props {
  compare: PopularCompare;
  categoryNames: ReadonlyMap<string, string>;
  onSearchKeyword: (keyword: string) => void;
}

function KeywordTable({ rows }: { rows: readonly CompareKeywordRow[] }) {
  return (
    <table className="compare-table">
      <thead>
        <tr>
          <th scope="col">키워드</th>
          <th scope="col">검색 결과</th>
          <th scope="col">인기 차트</th>
          <th scope="col">차이</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.keyword}>
            <th scope="row">{row.keyword}</th>
            <td>
              {pct(row.slotShare)} <small>영상 {row.slotCount}개</small>
            </td>
            <td>
              {pct(row.popularShare)} <small>영상 {row.popularCount}개</small>
            </td>
            <td
              className={`trend-delta${row.deltaPp !== null ? (row.deltaPp > 0 ? ' is-up' : row.deltaPp < 0 ? ' is-down' : '') : ''}`}
            >
              {pp(row.deltaPp)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Metric = 'views' | 'likes';

/**
 * 내 검색 결과와 인기 차트 전체, 인기 차트의 핫 키워드 영상 묶음의 조회수·좋아요 중앙값을 가로 막대로 비교한다.
 * 공개되지 않은 값은 제외한 중앙값이다. 내 검색 결과 막대만 강조색을 쓴다.
 */
function EngagementBars({ rows }: { rows: readonly CompareEngagementRow[] }) {
  const [metric, setMetric] = useState<Metric>('views');
  const valueOf = (row: CompareEngagementRow) =>
    metric === 'views' ? row.medianViews : row.medianLikes;
  const max = Math.max(1, ...rows.map((row) => valueOf(row) ?? 0));
  const unit = metric === 'views' ? '조회수' : '좋아요';
  return (
    <div className="engagement">
      <div className="engagement-head">
        <h3 className="compare-sub">영상 {unit} 비교 · 중앙값</h3>
        <div className="engagement-toggle" role="group" aria-label="비교 지표">
          {(['views', 'likes'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
            >
              {key === 'views' ? '조회수' : '좋아요'}
            </button>
          ))}
        </div>
      </div>
      <ul className="engagement-bars" aria-label={`${unit} 중앙값 비교`}>
        {rows.map((row) => {
          const value = valueOf(row);
          return (
            <li key={`${row.kind}:${row.label}`} className={`is-${row.kind}`}>
              <span className="engagement-label">
                {row.label}
                <small>영상 {row.videos}개</small>
              </span>
              <span className="engagement-track" aria-hidden="true">
                <span
                  className="engagement-fill"
                  style={{ width: `${value === null ? 0 : Math.max(2, (value / max) * 100)}%` }}
                />
              </span>
              <span className="engagement-value">
                {value === null ? '정보 없음' : formatCount(value)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="trend-note">
        핫 키워드는 같은 시각 인기 차트에서 영상이 가장 많은 키워드(내 검색어 제외)이며, 그 키워드가
        제목·태그에 나온 인기 영상들의 중앙값입니다. 공개되지 않은 값은 제외합니다.
      </p>
    </div>
  );
}

function biggestCategory(
  rows: readonly CompareCategoryRow[],
  names: ReadonlyMap<string, string>,
): { label: string; note: string } {
  const top = rows[0];
  if (!top) return { label: '정보 없음', note: '카테고리 집계가 없습니다' };
  const name = names.get(top.categoryId) ?? '카테고리 정보 없음';
  return {
    label: `${name} ${pp(top.deltaPp)}`,
    note: `검색 결과 ${pct(top.slotShare)} · 인기 차트 ${pct(top.popularShare)}`,
  };
}

/** 내 검색어 결과를 같은 시각의 인기 차트와 비교한다. 두 표본의 크기가 달라 비율로 비교한다. */
export default function PopularCompareSection({ compare, categoryNames, onSearchKeyword }: Props) {
  const basis = '같은 시각 근처의 인기 차트 수집과 비교';
  if (!compare.available)
    return (
      <DashSection title="인기 차트와 비교" basis={basis} className="popular-compare">
        <p className="dash-empty" role="status">
          비교할 인기 차트 수집이 없습니다. 이 검색어의 수집 시각({when(compare.slot.scheduledFor)})
          전후 26시간 안에 완료된 인기 차트 수집이 없습니다.
        </p>
      </DashSection>
    );

  const { exposure, keywords, videos, categories } = compare;
  const best = exposure.tokens
    .filter((token) => token.popularCount !== null)
    .sort((a, b) => (b.popularCount ?? 0) - (a.popularCount ?? 0))[0];
  const category = biggestCategory(categories, categoryNames);

  return (
    <DashSection title="인기 차트와 비교" basis={basis} className="popular-compare">
      <dl className="trend-tiles">
        <div>
          <dt>인기 차트 노출</dt>
          <dd>
            {exposure.noTokens ? (
              <small>비교할 키워드 토큰이 없습니다</small>
            ) : best ? (
              <>
                {best.popularCount}개 영상
                <small>
                  {' '}
                  · {pct(best.popularShare)} · 인기 키워드 {best.rank}위 (‘{best.keyword}’)
                </small>
              </>
            ) : (
              <>
                없음
                <small> · 인기 차트 키워드 집계에 나오지 않음(영상 2개 미만 포함)</small>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>인기 차트에 든 영상</dt>
          <dd>
            {videos.count}개
            <small>
              {' '}
              · 검색 결과의 {pct(videos.share)}
              {videos.bestPosition !== null && ` · 최고 ${videos.bestPosition}위`}
            </small>
          </dd>
        </div>
        <div>
          <dt>분야 차이가 가장 큰 곳</dt>
          <dd>
            {category.label}
            <small> · {category.note}</small>
          </dd>
        </div>
      </dl>
      {compare.slotKeywordCount === 0 && (
        <p role="alert" className="trend-warning">
          이 검색어는 키워드 집계에 실패했습니다(2개 이상 영상에 함께 나온 키워드가 없음). 다른
          키워드로 변경해 주세요.
        </p>
      )}
      <EngagementBars rows={compare.engagement} />
      <p className="trend-note">
        검색 결과 {compare.slot.itemCount}개({when(compare.slot.scheduledFor)} 수집) vs 인기 차트{' '}
        {compare.popular.itemCount}개({when(compare.popular.scheduledFor)} 수집) · 표본 크기가 달라
        비율로 비교합니다. 키워드 집계는 영상 2개 이상에 나온 단어만 저장되어, 한쪽에 없다는 것은
        0개가 아니라 기준 미만이라는 뜻일 수 있습니다.
      </p>

      <h3 className="compare-sub">검색 결과와 인기 차트가 함께 쓰는 키워드</h3>
      {keywords.common.length ? (
        <KeywordTable rows={keywords.common} />
      ) : compare.slotKeywordCount === 0 ? (
        <p className="dash-empty">
          키워드 집계에 실패해 비교할 수 없습니다. 다른 키워드로 변경해 주세요.
        </p>
      ) : (
        <p className="dash-empty">겹치는 키워드가 없습니다 — 인기 차트와 다른 흐름의 주제입니다.</p>
      )}

      {keywords.slotOnly.length > 0 && (
        <>
          <h3 className="compare-sub">검색 결과에만 있는 키워드 · 누르면 검색</h3>
          <ul className="compare-chips">
            {keywords.slotOnly.map((row) => (
              <li key={row.keyword}>
                <button
                  type="button"
                  className="keyword-chip"
                  aria-label={`${row.keyword} 검색 (검색 결과 영상 ${row.slotCount}개에 등장)`}
                  onClick={() => onSearchKeyword(row.keyword)}
                >
                  {row.keyword} <span aria-hidden="true">· 영상 {row.slotCount}개</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </DashSection>
  );
}
