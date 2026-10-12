import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { QuestionMarkCircledIcon } from '@radix-ui/react-icons';

/** 말풍선이 화면 가장자리에서 떨어져 있어야 하는 최소 거리(px) */
const EDGE_GAP = 12;

/**
 * 제목 옆 ? 아이콘. 마우스를 올리거나 키보드로 초점을 주면 설명이 나타나고 Esc로 닫는다.
 * 제목 아래에 늘 깔던 기준·안내 문구를 여기로 옮겨 본문을 가볍게 한다.
 *
 * 말풍선은 열려 있을 때만 레이아웃에 들어간다(닫힌 상태는 display: none). 그래서 화면 밖에 걸쳐 있는
 * 보이지 않는 말풍선이 가로 스크롤을 만들지 못하고, 열리는 순간 보이는 폭 안으로 위치를 맞춘다.
 */
export default function HelpTip({
  children,
  label = '설명 보기',
  align = 'start',
}: {
  children: ReactNode;
  label?: string;
  /** 오른쪽 끝에 놓인 ?는 end로 두어 설명이 화면 밖으로 나가지 않게 한다. */
  align?: 'start' | 'end';
}) {
  const id = useId();
  const bubble = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;

  // CSS의 translate(--shift)로 말풍선을 화면 안쪽으로 민다.
  const place = useCallback(() => {
    const element = bubble.current;
    if (!element) return;
    element.style.setProperty('--shift', '0px');
    const rect = element.getBoundingClientRect();
    if (!rect.width) return;
    const viewport = document.documentElement.clientWidth;
    let shift = 0;
    if (rect.right > viewport - EDGE_GAP) shift = viewport - EDGE_GAP - rect.right;
    if (rect.left + shift < EDGE_GAP) shift = EDGE_GAP - rect.left;
    element.style.setProperty('--shift', `${Math.round(shift)}px`);
  }, []);

  // 열리는 순간(그려지기 전에) 위치를 맞추고, 열려 있는 동안 화면 크기가 바뀌면 다시 맞춘다.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, place]);

  // Esc로 닫는다(초점과 마우스 올림 모두 해제).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setHovered(false);
      setFocused(false);
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <span
      className={`help-tip is-${align}${open ? ' is-open' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="help-tip-trigger"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <QuestionMarkCircledIcon aria-hidden="true" />
      </button>
      <span ref={bubble} role="tooltip" id={id} className="help-tip-bubble">
        {children}
      </span>
    </span>
  );
}
