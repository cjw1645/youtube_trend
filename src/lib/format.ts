/** 숫자 범위의 물결을 대시로 표시해 Markdown 취소선 표기와 혼동하지 않게 한다. */
export function formatNumericRanges(text: string): string {
  return text.replace(/(\d[\d,.]*\s*(?:개|자|초|분|시간|명|만|억|%|원)?)[ \t]*~+[ \t]*(?=\d)/g, '$1–');
}

/** 1234 → "1,234", 12345 → "1.2만", 123456789 → "1.2억". null은 정보 없음. */
export function formatCount(n: number | null): string {
  if (n === null) return '정보 없음';
  if (n >= 1e8) return `${trim(n / 1e8)}억`;
  if (n >= 1e4) return `${trim(n / 1e4)}만`;
  return n.toLocaleString('ko-KR');
}

function trim(value: number): string {
  return (value >= 100 ? Math.round(value) : Math.round(value * 10) / 10).toString();
}

/** ISO 시각 → "3시간 전", "2일 전" 등 */
export function formatRelativeDate(iso: string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [
    [60 * 60 * 24 * 365, '년'],
    [60 * 60 * 24 * 30, '개월'],
    [60 * 60 * 24 * 7, '주'],
    [60 * 60 * 24, '일'],
    [60 * 60, '시간'],
    [60, '분'],
  ];
  for (const [size, label] of units) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${label} 전`;
  }
  return '방금 전';
}

/** ISO 시각 → "2026. 10. 6." */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ko-KR');
}

/** 초 → "3:05", "1:02:03" */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (v: number) => v.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
