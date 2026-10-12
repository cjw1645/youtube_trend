import { useEffect, useRef, useState } from 'react';

/** 한 번 갱신할 때까지의 간격(ms) */
const TICK_MS = 28;
/** 한 번에 보이는 글자 수. 요약은 약 70자/초, 그 아래 근거·제안은 약 110자/초로 읽을 수 있는 속도를 유지한다. */
const SUMMARY_STEP = 2;
const REST_STEP = 3;

/**
 * 방금 받은 답변을 채팅처럼 앞에서부터 보여 주기 위한 글자 수.
 * enabled가 꺼져 있거나 모션 줄이기 설정이면 처음부터 전부 보이도록 reveal이 undefined다.
 * slowUntil까지(핵심 요약)는 가장 천천히, 그 뒤(근거·제안)는 조금 빠르지만 읽을 수 있는 속도로 보여 준다.
 */
export function useTypedReveal(
  total: number,
  slowUntil: number,
  enabled: boolean,
  onTick?: () => void,
) {
  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const tick = useRef(onTick);
  useEffect(() => {
    tick.current = onTick;
  });
  const active = enabled && !reduced && !skipped && total > 0;
  const done = shown >= total;
  useEffect(() => {
    if (!active || done) return;
    const timer = window.setInterval(() => {
      setShown((now) => Math.min(total, now + (now < slowUntil ? SUMMARY_STEP : REST_STEP)));
      tick.current?.();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, done, total, slowUntil]);
  const typing = active && !done;
  return {
    /** 지금까지 보여 줄 글자 수. undefined면 전부 보인다. */
    reveal: typing ? shown : undefined,
    typing,
    skip: () => setSkipped(true),
  };
}
