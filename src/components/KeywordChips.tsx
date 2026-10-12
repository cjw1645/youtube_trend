import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aggregateKeywords } from '../lib/stats';
import type { Video } from '../types/video';

/** 현재 조회된 목록 안의 키워드만 보여준다. 누르면 이 목록 안에서 그 단어가 든 영상만 거른다(새 검색이 아니다). */
export default function KeywordChips({
  videos,
  query,
  active,
  onPick,
}: {
  videos: readonly Video[];
  /** 현재 적용된 검색어. 같은 키워드 칩은 표시하지 않는다. */
  query: string;
  /** 지금 거르고 있는 키워드. 없으면 빈 문자열 */
  active: string;
  onPick: (keyword: string) => void;
}) {
  const keywords = useMemo(() => aggregateKeywords(videos, { query }), [videos, query]);
  const list = useRef<HTMLUListElement>(null);
  // 가로 스크롤 행(모바일)에 오른쪽으로 더 볼 칩이 남아 있으면 페이드 힌트를 보여준다.
  const [hasMore, setHasMore] = useState(false);
  const measure = useCallback(() => {
    const element = list.current;
    setHasMore(!!element && element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
  }, []);
  useEffect(() => {
    measure();
    if (!list.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list.current);
    return () => observer.disconnect();
  }, [measure, keywords]);
  if (!keywords.length) return null;
  return (
    <section className="keyword-row" aria-labelledby="keyword-row-title">
      <h3 id="keyword-row-title">
        현재 목록 {videos.length}개 기준 키워드 · 누르면 이 단어가 든 영상만 모아 봅니다
        {active && (
          <button type="button" className="keyword-clear" onClick={() => onPick(active)}>
            ‘{active}’ 거르기 해제
          </button>
        )}
      </h3>
      <div className="keyword-scroll" data-more={hasMore || undefined}>
        <ul ref={list} onScroll={measure}>
          {keywords.map(({ keyword, videos: count }) => (
            <li key={keyword}>
              <button
                type="button"
                className={`keyword-chip ${keyword === active ? 'is-active' : ''}`}
                aria-pressed={keyword === active}
                aria-label={`${keyword} 포함 영상만 보기 (현재 목록의 영상 ${count}개에 등장)`}
                onClick={() => onPick(keyword)}
              >
                {keyword} <span aria-hidden="true">· 영상 {count}개</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
