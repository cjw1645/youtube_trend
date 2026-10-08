import type { CSSProperties } from 'react';

export interface CloudWord {
  key: string;
  label: string;
  /** 글자 크기를 정하는 값(영상 수 등) */
  weight: number;
  /** 접근성용 전체 설명 */
  title: string;
  /** 기준 대비 늘었으면 true, 줄었으면 false */
  rising?: boolean | null;
}

/** 큰 단어가 가운데로 모이도록 양쪽 끝에서부터 번갈아 배치한다. */
function centered<T>(sorted: readonly T[]): T[] {
  const left: T[] = [];
  const right: T[] = [];
  sorted.forEach((item, index) => (index % 2 ? left : right).push(item));
  return [...left.reverse(), ...right];
}

/** 키워드 구름: 많이 나온 단어일수록 크고 진하다. 누르면 onSelect가 호출된다. */
export default function WordCloud({
  words,
  selected,
  onSelect,
}: {
  words: readonly CloudWord[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const sorted = [...words].sort((a, b) => b.weight - a.weight);
  const max = sorted[0]?.weight || 1;
  const min = sorted.at(-1)?.weight ?? 0;
  const span = Math.max(max - min, 1);
  const rank = new Map(sorted.map((word, index) => [word.key, index]));
  return (
    <ul className="cloud" aria-label="키워드 구름">
      {centered(sorted).map((word) => {
        const t = (word.weight - min) / span;
        const order = rank.get(word.key) ?? 0;
        return (
          <li key={word.key}>
            <button
              type="button"
              className={`cloud-word ${order < 3 ? 'is-hot' : ''}`}
              aria-pressed={selected === word.key}
              title={word.title}
              style={
                {
                  '--size': `${Math.round(14 + t * 22)}px`,
                  '--tone': 0.55 + t * 0.45,
                  '--delay': `${Math.min(order, 30) * 28}ms`,
                } as CSSProperties
              }
              onClick={() => onSelect(word.key)}
            >
              {word.label}
              {word.rising === true && <sup className="cloud-up">▲</sup>}
              {word.rising === false && <sup className="cloud-down">▼</sup>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
