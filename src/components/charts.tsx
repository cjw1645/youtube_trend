import { useId } from 'react';

/** 어두운 배경에서 서로 구분되는 계열 색. 첫 색이 강조색이다. */
export const CHART_COLORS = ['#ff5a4d', '#ffa23d', '#f4d35e', '#5ec2b7', '#7a8cff', '#c07aff'];

export interface Slice {
  label: string;
  value: number;
}

/** 도넛 그래프: 값 비율대로 호가 그려지며 처음에만 한 번 그려진다. */
export function DonutChart({
  slices,
  total,
  centerLabel,
  centerNote,
}: {
  slices: readonly Slice[];
  /** 비율의 분모. 없으면 slices 합계 */
  total?: number;
  centerLabel: string;
  centerNote: string;
}) {
  const sum = total ?? slices.reduce((acc, s) => acc + s.value, 0);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${centerNote} ${centerLabel}`}>
        <circle cx="70" cy="70" r={radius} className="donut-track" />
        {slices.map((slice, index) => {
          const length = sum > 0 ? (slice.value / sum) * circumference : 0;
          const circle = (
            <circle
              key={slice.label}
              cx="70"
              cy="70"
              r={radius}
              className="donut-slice"
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeDasharray={`${Math.max(length - 1.5, 0)} ${circumference}`}
              strokeDashoffset={-offset}
              style={{ animationDelay: `${index * 90}ms` }}
              transform="rotate(-90 70 70)"
            >
              <title>{`${slice.label} ${slice.value}개`}</title>
            </circle>
          );
          offset += length;
          return circle;
        })}
        <text x="70" y="68" textAnchor="middle" className="donut-value">
          {centerLabel}
        </text>
        <text x="70" y="86" textAnchor="middle" className="donut-note">
          {centerNote}
        </text>
      </svg>
      <ul className="legend">
        {slices.map((slice, index) => (
          <li key={slice.label}>
            <span
              className="legend-dot"
              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="legend-name">{slice.label}</span>
            <span className="legend-value">
              {sum > 0 ? Math.round((slice.value / sum) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 막대 그래프(세로). 가장 큰 값만 강조한다. */
export function ColumnChart({
  items,
  unit,
}: {
  items: readonly { label: string; value: number }[];
  unit: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));
  const top = items.findIndex((item) => item.value === max);
  return (
    <ol className="columns" aria-label={`${unit} 막대 그래프`}>
      {items.map((item, index) => (
        <li key={item.label} title={`${item.label} ${item.value}${unit}`}>
          <span className="column-value">{item.value}</span>
          <span
            className={`column-bar ${index === top && item.value > 0 ? 'is-top' : ''}`}
            style={{ height: `${(item.value / max) * 100}%`, animationDelay: `${index * 60}ms` }}
          />
          <span className="column-label">{item.label}</span>
        </li>
      ))}
    </ol>
  );
}

export interface LineSeries {
  label: string;
  /** 값이 없는 시점은 null이다. 0으로 잇지 않고 선을 끊는다. */
  values: readonly (number | null)[];
}

/** 선 그래프: 여러 계열의 수집 시점별 값. 선은 처음에 한 번 그려진다. */
export function LineChart({
  series,
  labels,
  unit,
}: {
  series: readonly LineSeries[];
  labels: readonly string[];
  unit: string;
}) {
  const id = useId();
  const w = 640;
  const h = 200;
  const padL = 30;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const x = (i: number) =>
    labels.length > 1 ? padL + (i / (labels.length - 1)) * (w - padL - padR) : (w + padL) / 2;
  const y = (v: number) => padT + (1 - v / max) * (h - padT - padB);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));
  return (
    <div className="linechart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${unit} 추이 선 그래프`}>
        <defs>
          {series.map((s, index) => (
            <linearGradient key={s.label} id={`${id}-${index}`} x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0"
                stopColor={CHART_COLORS[index % CHART_COLORS.length]}
                stopOpacity="0.28"
              />
              <stop
                offset="1"
                stopColor={CHART_COLORS[index % CHART_COLORS.length]}
                stopOpacity="0"
              />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={w - padR} y1={y(tick)} y2={y(tick)} className="grid-line" />
            <text x={padL - 6} y={y(tick) + 4} textAnchor="end" className="axis-text">
              {tick}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          index % labelStep === 0 || index === labels.length - 1 ? (
            <text
              key={`${label}${index}`}
              x={x(index)}
              y={h - 6}
              textAnchor="middle"
              className="axis-text"
            >
              {label}
            </text>
          ) : null,
        )}
        {series.map((s, index) => {
          const color = CHART_COLORS[index % CHART_COLORS.length];
          const runs: { i: number; v: number }[][] = [];
          let run: { i: number; v: number }[] = [];
          s.values.forEach((v, i) => {
            if (v === null) {
              if (run.length) runs.push(run);
              run = [];
            } else run.push({ i, v });
          });
          if (run.length) runs.push(run);
          return (
            <g key={s.label} style={{ animationDelay: `${index * 120}ms` }} className="line-group">
              {runs.map((points) => {
                const d = points
                  .map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
                  .join(' ');
                const first = points[0];
                const last = points[points.length - 1];
                return (
                  <g key={first.i}>
                    {points.length > 1 && (
                      <path
                        d={`${d} L${x(last.i).toFixed(1)},${y(0)} L${x(first.i).toFixed(1)},${y(0)} Z`}
                        fill={`url(#${id}-${index})`}
                        className="line-area"
                      />
                    )}
                    {points.length > 1 && (
                      <path d={d} pathLength={1} className="line-path" stroke={color} />
                    )}
                    {points.map((p) => (
                      <circle
                        key={p.i}
                        cx={x(p.i)}
                        cy={y(p.v)}
                        r="3"
                        fill={color}
                        className="line-dot"
                      >
                        <title>{`${s.label} · ${labels[p.i]} · ${p.v}${unit}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <ul className="legend is-inline">
        {series.map((s, index) => (
          <li key={s.label}>
            <span
              className="legend-dot"
              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
              aria-hidden="true"
            />
            <span className="legend-name">{s.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 한 줄 누적 막대: 구간별 비율. */
export function StackBar({ parts }: { parts: readonly { label: string; value: number }[] }) {
  const sum = parts.reduce((acc, part) => acc + part.value, 0);
  if (sum <= 0) return null;
  return (
    <div className="stackbar" role="img" aria-label="영상 길이 구간 비율">
      {parts.map((part, index) => (
        <span
          key={part.label}
          title={`${part.label} ${Math.round((part.value / sum) * 100)}%`}
          style={{
            flexGrow: part.value,
            background: CHART_COLORS[index % CHART_COLORS.length],
            animationDelay: `${index * 80}ms`,
          }}
        />
      ))}
    </div>
  );
}
