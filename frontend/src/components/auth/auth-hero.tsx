import { Phone } from "lucide-react";

/**
 * The sign-in art: a phone with the day's leads and a big green Call button, a gift (what we sell), a rising chart
 * tile, and a soft orbit. Pure HTML/SVG in percentages, so it scales cleanly from a phone banner to a 4K panel.
 */
export function AuthHero({ className }: { className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="relative aspect-[10/9] w-full [container-type:inline-size]">
        {/* glow, orbit and dots */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 500 450">
          <circle cx="245" cy="218" r="205" fill="#FFFFFF" opacity="0.05" />
          <circle cx="245" cy="218" r="170" fill="none" stroke="#FFFFFF" strokeOpacity="0.28" strokeWidth="1.5" strokeDasharray="3 5" />
          <circle cx="245" cy="218" r="128" fill="#FFFFFF" opacity="0.07" />
          <circle cx="92" cy="96" r="5" fill="#D6E9F5" opacity="0.85" />
          <circle cx="414" cy="300" r="5" fill="#D6E9F5" opacity="0.85" />
          <circle cx="66" cy="352" r="4" fill="#D6E9F5" opacity="0.6" />
          {/* sparkle */}
          <path d="M432 370 C 435 388, 440 393, 458 396 C 440 399, 435 404, 432 422 C 429 404, 424 399, 406 396 C 424 393, 429 388, 432 370 Z" fill="#FFFFFF" />
        </svg>

        {/* phone */}
        <div className="absolute left-[30%] top-[6%] flex h-[84%] w-[36%] flex-col rounded-[14cqw] bg-white px-[4.5cqw] pb-[5cqw] pt-[3.5cqw] shadow-[0_30px_60px_-24px_rgba(0,0,0,0.55)]">
          <span className="mx-auto h-[1.6cqw] w-[13cqw] rounded-full bg-[#AED3EA]" />
          <span className="mt-[3.5cqw] h-[2.2cqw] w-[15cqw] rounded-full bg-[#0F4C75]" />
          <div className="mt-[3.5cqw] space-y-[2.4cqw]">
            {[["#0F4C75", 13], ["#2273A6", 10], ["#4592C2", 6]].map(([c, w], i) => (
              <div key={i} className="flex items-center gap-[2.4cqw] rounded-[2.4cqw] bg-[#F3F8FC] px-[2cqw] py-[2cqw]">
                <span className="h-[3.4cqw] w-[3.4cqw] shrink-0 rounded-full" style={{ background: c as string }} />
                <div className="flex-1 space-y-[1cqw]">
                  <span className="block h-[1.3cqw] rounded-full bg-[#D6E9F5]" style={{ width: `${w as number * 4}%` }} />
                  <span className="block h-[1.3cqw] w-[55%] rounded-full bg-[#E6F0F7]" />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-[4cqw] h-[2cqw] rounded-full bg-[#D6E9F5]"><div className="h-full w-[62%] rounded-full bg-[#0F4C75]" /></div>
          <div className="mt-auto flex justify-center">
            <span className="flex h-[13cqw] w-[13cqw] items-center justify-center rounded-full bg-[#22B35E] text-white shadow-[0_10px_20px_-8px_rgba(34,179,94,0.8)]">
              <Phone className="h-[45%] w-[45%]" strokeWidth={2.4} fill="currentColor" />
            </span>
          </div>
        </div>

        {/* chart tile */}
        <div className="animate-float absolute left-[69%] top-[24%] flex aspect-[1.35] w-[23%] items-end gap-[1.6cqw] rounded-[4cqw] bg-white px-[3.2cqw] pb-[3.2cqw] shadow-[0_18px_36px_-14px_rgba(0,0,0,0.5)]">
          {[["#4592C2", 22], ["#2273A6", 40], ["#155D8C", 58], ["#0F4C75", 78]].map(([c, h], i) => (
            <span key={i} className="flex-1 rounded-[0.8cqw]" style={{ background: c as string, height: `${h}%` }} />
          ))}
          <span className="absolute right-[7%] top-[12%] h-[2.6cqw] w-[2.6cqw] rounded-full bg-[#22C55E]" />
        </div>

        {/* gift */}
        <svg className="animate-float-slow absolute left-[2%] top-[42%] w-[21%] drop-shadow-[0_16px_24px_rgba(0,0,0,0.35)]" viewBox="0 0 100 100">
          <rect x="8" y="38" width="84" height="56" rx="8" fill="#FFFFFF" />
          <rect x="4" y="30" width="92" height="18" rx="6" fill="#F4F8FB" />
          <rect x="44" y="30" width="12" height="64" fill="#F59E0B" />
          <path d="M50 30 C 36 8, 14 12, 22 26 C 26 32, 40 32, 50 30 Z" fill="none" stroke="#F59E0B" strokeWidth="6" strokeLinejoin="round" />
          <path d="M50 30 C 64 8, 86 12, 78 26 C 74 32, 60 32, 50 30 Z" fill="none" stroke="#F59E0B" strokeWidth="6" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
