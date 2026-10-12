import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { useRef } from 'react';
interface Props {
  value: string;
  onChange: (q: string) => void;
  onSearch: () => void;
}
/** 타이핑은 대기 조건만 바꾸고 명시적 제출 시 조회한다. */
export default function SearchBar({ value, onChange, onSearch }: Props) {
  // 한글 조합 중인지 직접 추적한다. Safari는 조합을 끝내는 Enter의 keydown에서 isComposing이 false라서,
  // compositionend 직후 한 틱 동안은 조합 중으로 본다(옛 keyCode 229 검사를 대체).
  const composing = useRef(false);
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
      className="search-form"
    >
      <div className="search-input">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (composing.current || event.nativeEvent.isComposing || event.repeat)
            )
              event.preventDefault();
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            setTimeout(() => {
              composing.current = false;
            }, 0);
          }}
          placeholder="키워드로 영상 검색"
          maxLength={100}
          aria-label="검색어"
        />
      </div>
      <button type="submit" className="primary-button">
        검색
      </button>
    </form>
  );
}
