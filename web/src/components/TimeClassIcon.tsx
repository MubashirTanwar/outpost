/** chess.com-style time-control icons: a bullet, a lightning bolt, a stopwatch and a sun. */
import { timeControlLabel } from "@/lib/timecontrol";

const COLOR: Record<string, string> = { bullet: "#e3aa24", blitz: "#f7c631", rapid: "#81b64c", daily: "#f7a531" };
const NAME: Record<string, string> = { bullet: "Bullet", blitz: "Blitz", rapid: "Rapid", daily: "Daily" };

export function timeClassName(tc: string): string {
  return NAME[tc] ?? tc.charAt(0).toUpperCase() + tc.slice(1);
}

export function TimeClassIcon({ timeClass, size = 18, className = "" }: { timeClass: string; size?: number; className?: string }) {
  const fill = COLOR[timeClass] ?? "#989795";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`shrink-0 ${className}`} role="img" aria-label={timeClassName(timeClass)}>
      <title>{timeClassName(timeClass)}</title>
      {timeClass === "bullet" ? (
        <g transform="rotate(-45 12 12)" fill={fill}>
          <path d="M5 9h9.5c3 0 5.5 1.4 6.5 3-1 1.6-3.5 3-6.5 3H5z" />
          <rect x="2" y="8.5" width="2" height="7" rx="0.6" />
        </g>
      ) : timeClass === "blitz" ? (
        <path fill={fill} d="M13.5 1.5 4 13.5h6.5L9 22.5l11-13h-7z" />
      ) : timeClass === "rapid" ? (
        <g fill={fill}>
          <rect x="9.5" y="1" width="5" height="2.4" rx="1" />
          <rect x="11" y="2.5" width="2" height="3" />
          <path d="M18.3 5.3 20 3.6l1.4 1.4-1.7 1.7z" />
          <path fillRule="evenodd" d="M12 23a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-2.4a6.6 6.6 0 1 0 0-13.2 6.6 6.6 0 0 0 0 13.2Z" />
          <path d="M11 9h2v5.2l-1 1-1-1z" />
        </g>
      ) : timeClass === "daily" ? (
        <g fill={fill}>
          <circle cx="12" cy="12" r="5" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x="11" y="1" width="2" height="4" rx="1" transform={`rotate(${a} 12 12)`} />
          ))}
        </g>
      ) : (
        <circle cx="12" cy="12" r="6" fill={fill} />
      )}
    </svg>
  );
}

/** Icon plus the time control, e.g. [bolt] 3 | 2. */
export function TimeControl({ timeClass, timeControl, size = 16 }: { timeClass: string; timeControl?: string | null; size?: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={timeClassName(timeClass)}>
      <TimeClassIcon timeClass={timeClass} size={size} />
      {timeControl ? <span>{timeControlLabel(timeControl)}</span> : null}
    </span>
  );
}
