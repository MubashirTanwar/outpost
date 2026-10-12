/** Outpost logo: smug Kittu on a 4x4 board, rating his own move Brilliant. */
export const APP_NAME = "Outpost";

export function LogoMark({ size = 32 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element -- a static SVG; next/image adds nothing here
  return <img src="/logo.svg" width={size} height={size} alt="" aria-hidden />;
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark size={30} />
      <span className="text-[19px] font-extrabold tracking-tight">{APP_NAME}</span>
    </span>
  );
}
