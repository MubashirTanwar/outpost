"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { niceTicks } from "@/lib/stats";

/** Categorical slots, fixed order (validated on the #262522 panel). */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70"] as const;

const PAD = { top: 12, right: 14, bottom: 26, left: 44 };
const AXIS = "#989795";
const GRID = "#3c3a37";

/** Width of the chart's container. A callback ref, so it attaches whenever the chart (re)mounts its plot. */
function useWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(([e]) =>
      setWidth(Math.max(240, e.contentRect.width)),
    );
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, width] as const;
}

const fmtDate = (t: number, long = false) =>
  new Date(t).toLocaleDateString(
    undefined,
    long
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric" },
  );

function timeTicks(lo: number, hi: number, n: number) {
  if (hi <= lo) return [lo];
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

export interface LinePoint {
  t: number;
  y: number;
  id?: string;
  label?: string; // extra tooltip line (e.g. "vs magnus · win")
}

export interface LineSeries {
  name: string;
  color: string;
  points: LinePoint[];
  dots?: boolean; // markers only, no line
  faint?: boolean;
}

function Tooltip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children: React.ReactNode;
}) {
  const left = x > width - 190 ? x - 190 : x + 12;
  return (
    <div
      className="pointer-events-none absolute z-10 w-[178px] rounded-md border border-line bg-[#1d1c1a] px-2.5 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(0, y - 10) }}
    >
      {children}
    </div>
  );
}

/** Time-based line chart with a crosshair tooltip; clicking a point with an id calls onPick. */
export function LineChart({
  series,
  height = 220,
  yFormat = (v) => String(Math.round(v)),
  yDomain,
  onPick,
  ariaLabel,
}: {
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  yDomain?: [number, number];
  onPick?: (id: string) => void;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null); // time under the cursor
  const all = series.flatMap((s) => s.points);
  if (!all.length)
    return (
      <div className="grid h-[120px] place-items-center text-sm text-muted">
        No games in this range yet.
      </div>
    );

  const ts = all.map((p) => p.t);
  const ys = all.map((p) => p.y);
  const [t0, t1] = [Math.min(...ts), Math.max(...ts)];
  const ticks = niceTicks(
    yDomain?.[0] ?? Math.min(...ys),
    yDomain?.[1] ?? Math.max(...ys),
    4,
  );
  const [y0, y1] = [ticks[0], ticks[ticks.length - 1]];
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const sx = (t: number) =>
    PAD.left + (t1 === t0 ? iw / 2 : ((t - t0) / (t1 - t0)) * iw);
  const sy = (v: number) => PAD.top + ih - ((v - y0) / (y1 - y0 || 1)) * ih;

  // Nearest point of each series to the hovered time.
  const nearest =
    hover == null
      ? []
      : series
          .filter((s) => s.points.length)
          .map((s) => ({
            s,
            p: s.points.reduce((a, b) =>
              Math.abs(b.t - hover) < Math.abs(a.t - hover) ? b : a,
            ),
          }));
  const anchor = nearest.length
    ? nearest.reduce((a, b) =>
        Math.abs(b.p.t - hover!) < Math.abs(a.p.t - hover!) ? b : a,
      )
    : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - box.left, PAD.left), PAD.left + iw);
    setHover(t0 + ((x - PAD.left) / (iw || 1)) * (t1 - t0));
  };

  return (
    <div
      ref={ref}
      className="relative w-full min-w-0"
      style={{ minHeight: height }}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className={`block ${onPick && anchor?.p.id ? "cursor-pointer" : ""}`}
          role="img"
          aria-label={ariaLabel}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onClick={() => anchor?.p.id && onPick?.(anchor.p.id)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={PAD.left + iw}
                y1={sy(v)}
                y2={sy(v)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={sy(v)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill={AXIS}
              >
                {yFormat(v)}
              </text>
            </g>
          ))}
          {timeTicks(t0, t1, width < 420 ? 3 : 5).map((t, i, arr) => (
            <text
              key={t}
              x={sx(t)}
              y={height - 6}
              textAnchor={
                i === 0 ? "start" : i === arr.length - 1 ? "end" : "middle"
              }
              fontSize={11}
              fill={AXIS}
            >
              {fmtDate(t)}
            </text>
          ))}
          {anchor && (
            <line
              x1={sx(anchor.p.t)}
              x2={sx(anchor.p.t)}
              y1={PAD.top}
              y2={PAD.top + ih}
              stroke={AXIS}
              strokeDasharray="3 3"
            />
          )}
          {series.map((s) =>
            s.dots ? (
              <g key={s.name} opacity={s.faint ? 0.55 : 1}>
                {s.points.map((p, i) => (
                  <circle
                    key={i}
                    cx={sx(p.t)}
                    cy={sy(p.y)}
                    r={3}
                    fill={s.color}
                    stroke="#262522"
                    strokeWidth={1.5}
                  />
                ))}
              </g>
            ) : (
              <path
                key={s.name}
                d={s.points
                  .map(
                    (p, i) =>
                      `${i ? "L" : "M"}${sx(p.t).toFixed(1)},${sy(p.y).toFixed(1)}`,
                  )
                  .join("")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={s.faint ? 0.55 : 1}
              />
            ),
          )}
          {nearest.map(({ s, p }) => (
            <circle
              key={s.name}
              cx={sx(p.t)}
              cy={sy(p.y)}
              r={5}
              fill={s.color}
              stroke="#262522"
              strokeWidth={2}
            />
          ))}
        </svg>
      )}
      {anchor && (
        <Tooltip x={sx(anchor.p.t)} y={sy(anchor.p.y)} width={width}>
          <div className="mb-1 font-bold text-white">
            {fmtDate(anchor.p.t, true)}
          </div>
          {nearest.map(({ s, p }) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-2 text-soft"
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: s.color }}
                />
                {s.name}
              </span>
              <span className="font-bold text-white">{yFormat(p.y)}</span>
            </div>
          ))}
          {anchor.p.label && (
            <div className="mt-1 text-muted">{anchor.p.label}</div>
          )}
          {onPick && anchor.p.id && (
            <div className="mt-1 text-muted">Click to open the review</div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string; // x label for the tooltip
  value: number | null;
  detail?: string;
}

/** Vertical bars anchored to zero, one hover tooltip per bar. */
export function BarChart({
  data,
  color,
  height = 200,
  yFormat = (v) => v.toFixed(1),
  ariaLabel,
}: {
  data: BarDatum[];
  color: string;
  height?: number;
  yFormat?: (v: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => d.value ?? 0);
  if (!values.some((v) => v > 0) && !data.some((d) => d.value != null))
    return (
      <div className="grid h-[120px] place-items-center text-sm text-muted">
        No games in this range yet.
      </div>
    );
  const ticks = niceTicks(0, Math.max(1, ...values), 4);
  const top = ticks[ticks.length - 1];
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const slot = iw / data.length;
  const gap = Math.min(2, slot * 0.3);
  const bw = Math.max(1, slot - gap);
  const sy = (v: number) => PAD.top + ih - (v / top) * ih;
  // Room for a label roughly every 110px (weekly labels are long).
  const step = Math.ceil(data.length / Math.max(2, Math.floor(iw / 110)));

  return (
    <div
      ref={ref}
      className="relative w-full min-w-0"
      style={{ minHeight: height }}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block"
          role="img"
          aria-label={ariaLabel}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={PAD.left + iw}
                y1={sy(v)}
                y2={sy(v)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={sy(v)}
                dy="0.32em"
                textAnchor="end"
                fontSize={11}
                fill={AXIS}
              >
                {yFormat(v)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + gap / 2;
            const v = d.value ?? 0;
            const h = (v / top) * ih;
            const r = Math.min(4, bw / 2, h);
            return (
              <g key={d.key} onPointerEnter={() => setHover(i)}>
                {/* Hit target: the whole column, bigger than the bar. */}
                <rect
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={ih}
                  fill="transparent"
                />
                {hover === i && (
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={ih}
                    fill="#ffffff"
                    opacity={0.05}
                  />
                )}
                {h > 0 && (
                  <path
                    d={`M${x},${PAD.top + ih} V${PAD.top + ih - h + r} Q${x},${PAD.top + ih - h} ${x + r},${PAD.top + ih - h} H${x + bw - r} Q${x + bw},${PAD.top + ih - h} ${x + bw},${PAD.top + ih - h + r} V${PAD.top + ih} Z`}
                    fill={color}
                  />
                )}
                {i % step === 0 && (
                  <text
                    x={x + bw / 2}
                    y={height - 6}
                    textAnchor={
                      i === 0
                        ? "start"
                        : i + step >= data.length
                          ? "end"
                          : "middle"
                    }
                    fontSize={11}
                    fill={AXIS}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && (
        <Tooltip
          x={PAD.left + hover * slot + slot / 2}
          y={sy(values[hover])}
          width={width}
        >
          <div className="mb-1 font-bold text-white">{data[hover].label}</div>
          <div className="text-soft">
            {data[hover].value == null
              ? "No games"
              : `${yFormat(data[hover].value!)} blunders / game`}
          </div>
          {data[hover].detail && (
            <div className="mt-1 text-muted">{data[hover].detail}</div>
          )}
        </Tooltip>
      )}
    </div>
  );
}

export function Legend({
  items,
}: {
  items: { name: string; color: string; dot?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-soft">
      {items.map((i) => (
        <span key={i.name} className="flex items-center gap-1.5">
          {i.dot ? (
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: i.color }}
            />
          ) : (
            <span
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: i.color }}
            />
          )}
          {i.name}
        </span>
      ))}
    </div>
  );
}
