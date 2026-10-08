import type { BaselineKind, Comparison } from '../types/trend';

/** 비교 기준 선택 순서. 전일 동시간이 기본이고, 없으면 7일 전 → 직전 수집 → 28일 전 순으로 쓴다. */
export const BASELINE_PREFERENCE: readonly BaselineKind[] = ['day', 'week', 'previous', 'month'];

/**
 * 처음 선택할 비교 기준. 사용할 수 있는 수집이 하나도 없으면 전일 동시간을 고르고,
 * 전일 동시간이 아닌 기준으로 물러났다면 fallback에 true를 돌려 화면이 이유를 알리게 한다.
 */
export function pickDefaultBaseline(
  comparisons: readonly Pick<Comparison, 'kind' | 'available'>[],
): {
  kind: BaselineKind;
  fallback: boolean;
} {
  const kind = BASELINE_PREFERENCE.find((preferred) =>
    comparisons.some((c) => c.kind === preferred && c.available),
  );
  return kind ? { kind, fallback: kind !== 'day' } : { kind: 'day', fallback: false };
}
