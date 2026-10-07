import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aggregateKeywords } from '../lib/keywords';
import type { Video } from '../types/video';

/** 현재 조회된 목록 안의 키워드만 보여주며, 클릭하면 해당 키워드로 검색한다. */
export default function KeywordChips({
  videos,
  query,
  onSearch,
}: {
  videos: readonly Video[];
  /** 현재 적용된 검색어. 같은 키워드 칩은 표시하지 않는다. */
  query: string;
  onSearch: (keyword: string) => void;
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
        현재 목록 {videos.length}개 기준 키워드 · 2개 이상 채널에 등장한 단어
      </h3>
      <div className="keyword-scroll" data-more={hasMore || undefined}>
        <ul ref={list} onScroll={measure}>
          {keywords.map(({ keyword, channels }) => (
            <li key={keyword}>
              <button
                type="button"
                className="keyword-chip"
                aria-label={`${keyword} 검색 (현재 목록의 채널 ${channels}곳에 등장)`}
                onClick={() => onSearch(keyword)}
              >
                {keyword} <span aria-hidden="true">· 채널 {channels}곳</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
