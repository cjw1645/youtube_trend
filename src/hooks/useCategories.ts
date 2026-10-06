import { useMemo } from 'react';
import { useApiResource } from './useApiResource';
import type { CategoriesResponse, Category } from '../types/video';

const EMPTY_CATEGORIES: Category[] = [];
/** 카테고리 실패를 안내하되 전체 영상 탐색은 계속 가능하다. */
export function useCategories() {
  const { state, reload } = useApiResource<CategoriesResponse>('/api/categories');
  const categories = state.status === 'success' ? state.data.items : EMPTY_CATEGORIES;

  const nameById = useMemo(() => new Map(categories.map((c) => [c.id, c.title])), [categories]);
  return { categories, nameById, state, reload };
}
