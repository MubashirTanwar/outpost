import { Kittu, type KittuMood } from "./Kittu";

const TONES = {
  white: "bg-white text-[#312e2b]",
  good: "bg-[#e6f4d9] text-[#3d6b1f]",
  bad: "bg-[#fde4e1] text-[#a1271a]",
} as const;

/**
 * Kittu with a speech bubble. `quip` is Kittu's attitude line; `children` is the actual
 * teaching content. Kittu does a little bounce whenever his mood changes.
 */
export function KittuBubble({
  mood,
  quip,
  children,
  tone = "white",
  size = 64,
}: {
  mood: KittuMood;
  quip?: string;
  children?: React.ReactNode;
  tone?: keyof typeof TONES;
  size?: number;
}) {
  return (
    <div className="flex items-start gap-2">
      <div key={mood} className="animate-pop shrink-0" style={{ width: size, height: size }}>
        <Kittu mood={mood} size={size} />
      </div>
      <div className={`relative mt-1 min-h-[56px] flex-1 rounded-xl p-3 text-[14px] shadow ${TONES[tone]}`}>
        <span className={`absolute -left-1.5 top-5 h-3 w-3 rotate-45 ${TONES[tone].split(" ")[0]}`} />
        {quip && <p className="font-extrabold italic">{quip}</p>}
        {children && <div className={quip ? "mt-1 font-semibold" : "font-semibold"}>{children}</div>}
      </div>
    </div>
  );
}
