import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 화면에 처음 들어올 때 한 번 true가 된다(스크롤 등장 효과용). 한 번 보이면 다시 숨기지 않는다.
 * 움직임을 줄이도록 설정했거나, IntersectionObserver가 없거나, 지금 보이지 않는 탭이거나(관찰자가 호출되지
 * 않아 영영 숨겨질 수 있음), 인쇄할 때는 애니메이션 없이 바로 true다.
 */
export function useReveal<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    const show = () => setSeen(true);
    if (
      !element ||
      typeof IntersectionObserver === 'undefined' ||
      document.visibilityState === 'hidden' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      show();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          show();
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    observer.observe(element);
    window.addEventListener('beforeprint', show);
    return () => {
      observer.disconnect();
      window.removeEventListener('beforeprint', show);
    };
  }, []);
  return [ref, seen];
}
