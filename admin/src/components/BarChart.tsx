import { useState } from 'react';
import { compact, money } from '../lib/format';

export interface DayPoint {
  day: string;
  count: number;
  failed: number;
  volume: string;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 44 };

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(iso));

/**
 * Single-series column chart of daily settled volume (TZS). One series, so no legend box:
 * the card title names it. Bars are capped at 24px with a 4px rounded top and square
 * baseline; hover shows exact values; a table view is available for screen readers.
 */
export function VolumeChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div className="empty">No activity in the last 14 days.</div>;

  const max = Math.max(1, ...data.map((d) => Number(d.volume)));
  const niceMax = niceCeil(max);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => PAD.top + innerH - (v / niceMax) * innerH;
  const ticks = [0, 0.5, 1].map((f) => f * niceMax);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily settled volume, last 14 days">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">{compact(String(t))}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = Number(d.volume);
          const x = PAD.left + band * i + (band - barW) / 2;
          const top = y(v);
          const h = Math.max(0, PAD.top + innerH - top);
          const r = Math.min(4, h);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect className="bar-hit" x={PAD.left + band * i} y={PAD.top} width={band} height={innerH} />
              {h > 0 && (
                <path
                  className={`bar${hover === i ? ' hover' : ''}`}
                  d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                />
              )}
              {(i === 0 || i === data.length - 1 || data.length <= 7) && (
                <text className="axis-label" x={x + barW / 2} y={H - 8} textAnchor="middle">{dayLabel(d.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div
          className="chart-tooltip"
          style={{ left: `${((PAD.left + band * hover + band / 2) / W) * 100}%`, top: `${(y(Number(data[hover].volume)) / H) * 100}%` }}
        >
          <strong>{dayLabel(data[hover].day)}</strong>
          <div>{money(data[hover].volume)}</div>
          <div className="muted">{data[hover].count} transactions · {data[hover].failed} failed</div>
        </div>
      )}
      <table className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        <caption>Daily settled volume</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}><td>{dayLabel(d.day)}</td><td>{money(d.volume)}</td><td>{d.count} transactions</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceCeil(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}
