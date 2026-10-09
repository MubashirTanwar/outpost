export function Progress({ stage, value }: { stage: string; value: number }) {
  return (
    <div className="w-full">
      <div className="mb-1.5 flex justify-between text-sm text-soft">
        <span>{stage}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-[#3c3a37]">
        <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
    </div>
  );
}
