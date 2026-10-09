/** Outpost logo: a knight standing on its outpost square. */
export const APP_NAME = "Outpost";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#81b64c" />
      <rect x="2" y="44" width="60" height="18" rx="0" fill="#5d8f37" />
      <rect x="2" y="48" width="60" height="14" rx="14" fill="#5d8f37" />
      {/* Knight */}
      <path
        d="M20 50 L44 50 L42 44 C42 36 46 31 45 24 C44 15 37 10 29 11 L27 7 L24 12 L18 18 L14 28 L17 31 L22 29 L27 28 C28 31 25 34 22 37 C19 40 19 45 20 50Z"
        fill="#fbf3e6"
        stroke="#2e3d22"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="27" cy="18" r="2" fill="#2e3d22" />
      <path d="M15 26 L19 26" stroke="#2e3d22" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="17" y="49" width="30" height="5" rx="2" fill="#fbf3e6" stroke="#2e3d22" strokeWidth="2" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={30} />
      <span className="text-[19px] font-extrabold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
