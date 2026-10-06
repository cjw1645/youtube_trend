import { useEffect, useMemo, useState } from 'react';
import { getJson } from '../lib/api';
import type { CategoriesResponse, Category } from '../types/video';

/** 카테고리는 한 번만 불러온다. 실패해도 목록 화면은 "전체"만으로 동작하도록 빈 배열 유지 */
export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    getJson<CategoriesResponse>('/api/categories', controller.signal)
      .then((res) => setCategories(res.items))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const nameById = useMemo(() => new Map(categories.map((c) => [c.id, c.title])), [categories]);
  return { categories, nameById };
}
