import { useEffect, useRef, useState } from 'react';

/** 한 번 갱신할 때까지의 간격(ms) */
const TICK_MS = 28;
/** 요약 구간에서 한 번에 보이는 글자 수(약 100자/초). 나머지 구간은 총량에 맞춰 더 빠르게 보인다. */
const SLOW_STEP = 3;
const FAST_TICKS = 70;

/**
 * 방금 받은 답변을 채팅처럼 앞에서부터 보여 주기 위한 글자 수.
 * enabled가 꺼져 있거나 모션 줄이기 설정이면 처음부터 전부 보이도록 reveal이 undefined다.
 * slowUntil까지(핵심 요약)는 천천히, 그 뒤(근거·제안)는 빠르게 보여 요약에 눈이 가게 한다.
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
    const fastStep = Math.max(SLOW_STEP, Math.ceil((total - slowUntil) / FAST_TICKS));
    const timer = window.setInterval(() => {
      setShown((now) => Math.min(total, now + (now < slowUntil ? SLOW_STEP : fastStep)));
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
