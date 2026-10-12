import { Cross2Icon } from '@radix-ui/react-icons';
import type { SlotView } from '../types/trend';
import { ORDER_LABEL, WINDOW_LABEL } from './AddSearchPopover';

interface Props {
  slots: readonly SlotView[];
  /** 선택된 검색어 슬롯. null이면 「인기 차트 전체」 탭이 선택된 것 */
  selected: 1 | 2 | null;
  busy: boolean;
  message: string | null;
  /** 로그인 여부를 몰라도 되도록 상위가 넘기는 빈 상태 문구 */
  emptyText: string;
  /** 로그인 확인이나 목록을 처음 불러오는 중이면 true. 빈 상태 문구 대신 불러오는 중이라고 알린다. */
  loading?: boolean;
  onSelect: (slot: 1 | 2) => void;
  onSelectPopular: () => void;
  /** 인기 차트 대시보드 영역의 id(탭이 제어하는 대상) */
  popularPanelId?: string;
  onRemove: (slot: 1 | 2) => void;
}

/**
 * 대시보드 탭 줄. 맨 왼쪽의 「인기 차트 전체」는 항상 있고, 그 오른쪽에 등록한 「내 검색어」 탭이 이어진다.
 * 고른 탭의 대시보드가 바로 아래에 나온다.
 */
export default function SearchTabs({
  slots,
  selected,
  busy,
  message,
  emptyText,
  loading = false,
  onSelect,
  onSelectPopular,
  popularPanelId,
  onRemove,
}: Props) {
  return (
    <div className="search-tabs">
      <nav className="dash-tabs search-tab-row" aria-label="대시보드 선택">
        <button
          type="button"
          className="popular-tab"
          aria-pressed={selected === null}
          aria-controls={popularPanelId}
          onClick={onSelectPopular}
        >
          인기 차트 전체
        </button>
        {slots.map((item) => (
          <span key={item.slot} className="search-tab">
            <button
              type="button"
              aria-pressed={selected === item.slot}
              onClick={() => onSelect(item.slot)}
              title={`${ORDER_LABEL[item.conditions.order]} · ${WINDOW_LABEL[item.conditions.window]}`}
            >
              {item.conditions.query}
            </button>
            <button
              type="button"
              className="tab-remove"
              disabled={busy}
              aria-label={`${item.conditions.query} 검색어 해제`}
              onClick={() => onRemove(item.slot)}
            >
              <Cross2Icon aria-hidden="true" />
            </button>
          </span>
        ))}
      </nav>
      {!slots.length && (
        <p className="search-tabs-empty" aria-busy={loading}>
          {loading ? '내 검색어를 불러오는 중…' : emptyText}
        </p>
      )}
      {message && (
        <p role="status" className="trend-note">
          {message}
        </p>
      )}
    </div>
  );
}
