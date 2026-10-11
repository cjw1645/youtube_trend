import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeywordCount } from '../lib/stats/keywords';

const MIN_SIZE = 13;
/** 단어 좌우 여백(px). 클릭 영역도 겸한다. */
const PAD_X = 3;
/** 위아래 단어 사이 최소 간격(px) */
const GAP_Y = 1;
/** 판 안쪽 여백과 모서리 둥글기(px). CSS의 .topic-cloud ul border-radius와 맞춘다. */
const INSET = 18;
const RADIUS = 28;

interface Placed extends KeywordCount {
  rank: number;
  size: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlaps = (a: Placed, b: Placed) =>
  a.left < b.left + b.width &&
  b.left < a.left + a.width &&
  a.top < b.top + b.height + GAP_Y &&
  b.top < a.top + a.height + GAP_Y;

/** 중심 기준 좌표 (x, y)가 반폭 hw·반높이 hh·모서리 반지름 r인 둥근 직사각형 안에 있는지 */
function insideRoundedRect(x: number, y: number, hw: number, hh: number, r: number) {
  const dx = Math.max(Math.abs(x) - (hw - r), 0);
  const dy = Math.max(Math.abs(y) - (hh - r), 0);
  return Math.abs(x) <= hw && Math.abs(y) <= hh && dx * dx + dy * dy <= r * r;
}

/**
 * 많이 나온 단어부터 판 중심에서 바깥으로 도는 나선을 따라 겹치지 않는 첫 자리에 놓는다.
 * 단어 상자의 네 모서리가 모두 둥근 직사각형 안에 들어와야 하며, 자리가 없으면 그 단어는 뺀다.
 * 같은 입력이면 항상 같은 배치다.
 */
function layout(
  words: readonly KeywordCount[],
  width: number,
  height: number,
  measure: (text: string, size: number, weight: number) => number,
  scale: number,
): Placed[] {
  const hw = width / 2 - INSET;
  const hh = height / 2 - INSET;
  const r = RADIUS - INSET / 2;
  const maxSize = Math.max(40, Math.min(100, width / 11)) * scale;
  const most = words[0]?.videos ?? 1;
  const least = words[words.length - 1]?.videos ?? 1;
  const placed: Placed[] = [];

  words.forEach((word, rank) => {
    const ratio = most === least ? 1 : (word.videos - least) / (most - least);
    // 1.6제곱: 많이 나온 몇 개만 확 크고, 나머지는 작게 모여 촘촘해진다.
    const size = Math.round(MIN_SIZE * scale + (maxSize - MIN_SIZE * scale) * ratio ** 1.6);
    const w = measure(word.keyword, size, rank < 3 ? 800 : rank < 10 ? 750 : 600) + PAD_X * 2;
    const h = Math.round(size * 1.22);
    const start = rank * 2.4;
    for (let step = 0; step < 6000; step += 1) {
      const angle = start + step * 0.1;
      const radius = step * 0.3;
      if (radius > hh * 1.5) break;
      const x = radius * Math.cos(angle) * (hw / hh);
      const y = radius * Math.sin(angle);
      const fits = [-1, 1].every((sx) =>
        [-1, 1].every((sy) => insideRoundedRect(x + (sx * w) / 2, y + (sy * h) / 2, hw, hh, r)),
      );
      if (!fits) continue;
      const box = {
        ...word,
        rank,
        size,
        left: width / 2 + x - w / 2,
        top: height / 2 + y - h / 2,
        width: w,
        height: h,
      };
      if (placed.every((other) => !overlaps(box, other))) {
        placed.push(box);
        return;
      }
    }
  });
  return placed;
}

const tone = (rank: number) =>
  rank < 3 ? `is-top is-${rank + 1}` : rank < 10 ? 'is-high' : rank < 24 ? 'is-mid' : 'is-low';

/**
 * 홈 화면용 키워드 구름: 영상 수에 비례한 크기로 단어를 둥근 직사각형 판 안에 촘촘히 놓는다.
 * 누르면 그 키워드로 검색한다.
 */
export default function TopicCloud({
  words,
  onSelect,
}: {
  words: readonly KeywordCount[];
  onSelect: (keyword: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const height = Math.round(Math.min(380, Math.max(280, width * 0.3)));

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    let alive = true;
    void document.fonts?.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, []);

  const placed = useMemo(() => {
    const node = ref.current;
    const context = document.createElement('canvas').getContext('2d');
    if (!node || !context || width === 0) return [];
    const family = getComputedStyle(node).fontFamily;
    const measure = (text: string, size: number, weight: number) => {
      context.font = `${weight} ${size}px ${family}`;
      // CSS의 letter-spacing -0.03em 만큼 줄인다.
      return Math.ceil(context.measureText(text).width - text.length * size * 0.03);
    };
    // 글자를 키워 가며 모든 단어가 판에 들어가는 가장 큰 배율을 고른다. 판이 비어 보이지 않게 하기 위함이다.
    let best = layout(words, width, height, measure, 1);
    for (const scale of [1.1, 1.2, 1.3, 1.4]) {
      const next = layout(words, width, height, measure, scale);
      if (next.length < best.length) break;
      best = next;
    }
    return best;
    // fontsReady는 웹폰트가 늦게 도착했을 때 글자 폭을 다시 재기 위한 의존성이다.
  }, [words, width, height, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={ref} className="topic-cloud">
      <ul style={{ height }}>
        {placed.map(({ keyword, videos, rank, size, left, top, width: w, height: h }) => (
          <li
            key={keyword}
            className={tone(rank)}
            style={
              {
                left,
                top,
                width: w,
                height: h,
                fontSize: size,
                '--i': Math.min(rank, 30),
              } as CSSProperties
            }
          >
            <button
              type="button"
              aria-label={`${keyword}, 영상 ${videos}개, 검색하기`}
              title={`영상 ${videos}개`}
              onClick={() => onSelect(keyword)}
            >
              {keyword}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
