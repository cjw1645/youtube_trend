import type { SortOrder } from '../types/video';

interface Props {
  /** 현재 목록에 실제로 있는 카테고리와 영상 수 */
  categories: readonly { id: string; label: string; count: number }[];
  categoryId: string;
  onCategoryChange: (id: string) => void;
  order: SortOrder | '';
  onOrderChange: (order: SortOrder | '') => void;
  /** 정렬 기본 옵션 이름. 인기 차트는 「인기순」, 검색 결과는 「관련도순」 */
  defaultOrderLabel: string;
}

/** 선택하는 즉시 현재 목록 안에서 적용한다(서버 호출 없음). */
export default function FilterBar({
  categories,
  categoryId,
  onCategoryChange,
  order,
  onOrderChange,
  defaultOrderLabel,
}: Props) {
  return (
    <div className="filter-bar">
      <label>
        카테고리
        <select value={categoryId} onChange={(event) => onCategoryChange(event.target.value)}>
          <option value="">전체 카테고리</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label} ({category.count})
            </option>
          ))}
        </select>
      </label>
      <label>
        정렬
        <select
          value={order}
          onChange={(event) => onOrderChange(event.target.value as SortOrder | '')}
        >
          <option value="">{defaultOrderLabel}</option>
          <option value="viewCount">조회수순</option>
          <option value="date">최신순</option>
        </select>
      </label>
    </div>
  );
}
