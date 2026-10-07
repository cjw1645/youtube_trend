import { useCallback, useMemo, useRef, useState } from 'react';
import { useApiResource } from './useApiResource';
import { getJson } from '../lib/api';
import type { CategoriesResponse, Category } from '../types/video';

const EMPTY_CATEGORIES: Category[] = [];
/** 카테고리 실패를 안내하되 전체 영상 탐색은 계속 가능하다. */
export function useCategories() {
  const { state, reload } = useApiResource<CategoriesResponse>('/api/categories');
  const categories = state.status === 'success' ? state.data.items : EMPTY_CATEGORIES;
  const [extraNames, setExtraNames] = useState<ReadonlyMap<string, string>>(new Map());
  const requested = useRef(new Set<string>());

  const baseNames = useMemo(() => new Map(categories.map((c) => [c.id, c.title])), [categories]);
  const nameById = useMemo(
    () => (extraNames.size ? new Map([...extraNames, ...baseNames]) : baseNames),
    [baseNames, extraNames],
  );

  /** 지역 목록에 없는 카테고리 ID만 모아 1회 일괄 조회한다. 실패하면 정보 없음으로 둔다. */
  const resolveNames = useCallback(
    (ids: readonly string[]) => {
      if (state.status !== 'success') return;
      const missing = [...new Set(ids)]
        .filter((id) => /^\d+$/.test(id) && !baseNames.has(id) && !requested.current.has(id))
        .sort((a, b) => Number(a) - Number(b))
        .slice(0, 50);
      if (!missing.length) return;
      missing.forEach((id) => requested.current.add(id));
      getJson<CategoriesResponse>(`/api/categories?id=${missing.join(',')}`)
        .then(({ items }) =>
          setExtraNames(
            (prev) => new Map([...prev, ...items.map((c) => [c.id, c.title] as const)]),
          ),
        )
        .catch(() => {});
    },
    [state.status, baseNames],
  );
  return { categories, nameById, resolveNames, state, reload };
}
