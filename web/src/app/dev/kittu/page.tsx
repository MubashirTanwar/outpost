import { KITTU_LINES, Kittu, type KittuMood } from "@/components/Kittu";

const MOODS: [KittuMood, string][] = [
  ["neutral", "Default stare"],
  ["thinking", "Waiting for your move"],
  ["happy", "Excellent / good move"],
  ["proud", "Best move / book"],
  ["starry", "Brilliant / great"],
  ["unimpressed", "Inaccuracy"],
  ["worried", "Mistake"],
  ["sad", "Missed chance"],
  ["shocked", "Blunder"],
  ["party", "Lesson complete"],
  ["smug", "Greeting / told-you-so"],
];

/** Mascot sheet: every expression and when it shows up. */
export default function KittuSheet() {
  return (
    <div className="p-8">
      <h1 className="mb-6 text-2xl font-extrabold">Kittu: all reactions</h1>
      <div className="grid grid-cols-4 lg:grid-cols-6 gap-5">
        {MOODS.map(([m, when]) => (
          <div key={m} className="flex flex-col items-center rounded-xl bg-panel p-4 text-center">
            <Kittu mood={m} size={170} />
            <span className="mt-2 font-extrabold capitalize">{m}</span>
            <span className="text-xs font-bold text-brand-light">{when}</span>
            <span className="mt-1 text-xs italic text-soft">“{KITTU_LINES[m][0]}”</span>
          </div>
        ))}
      </div>
    </div>
  );
}
