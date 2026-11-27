import type { ReactNode } from "react";
import { AuthHero } from "./auth-hero";

type Props = {
  /** Kept for the pages that pass it; every auth screen shares one hero. */
  art?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export const Logo = ({ tone = "dark" }: { tone?: "light" | "dark" }) => (
  <div className={`flex items-center gap-2.5 text-lg font-bold tracking-tight sm:text-xl ${tone === "light" ? "text-white" : "text-brand"}`}>
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold sm:h-10 sm:w-10 ${tone === "light" ? "bg-white text-brand" : "bg-brand text-white"}`} aria-hidden="true">T</span>
    TOFAA CRM
  </div>
);

/**
 * Two halves. Left: navy brand panel with the product art and the promise. Right: the form on a light field.
 *
 * Sizes:
 *  - phones (< 640px): a short navy banner (logo, small art, headline) above the form
 *  - tablets (640-1023px): a taller banner with the art beside the headline, form below
 *  - laptops and up (>= 1024px): the 50/50 split from the design; type and art scale with the window
 */
export function AuthShell({ title, subtitle, children, footer }: Props) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F5F9FC] lg:grid lg:grid-cols-2">
      {/* brand panel */}
      <aside className="relative overflow-hidden bg-[#0F4C75] text-white">
        {/* soft light swells, like the reference */}
        <div className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-white/[0.04]" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-56 right-[-6rem] h-[30rem] w-[30rem] rounded-full bg-white/[0.04]" aria-hidden="true" />

        <div className="relative mx-auto flex h-full max-w-[44rem] flex-col px-5 pb-8 pt-5 sm:px-10 sm:pb-10 sm:pt-8 lg:justify-between lg:px-[clamp(2.5rem,5vw,5rem)] lg:py-[clamp(2rem,5vh,4rem)]">
          <div className="lg:hidden"><Logo tone="light" /></div>

          <div className="mt-5 flex items-center gap-4 sm:mt-6 sm:gap-8 lg:mt-0 lg:flex-1 lg:flex-col lg:items-stretch lg:justify-center">
            <AuthHero className="w-[38%] max-w-[11rem] shrink-0 sm:w-[42%] sm:max-w-[16rem] lg:mx-auto lg:w-[min(82%,30rem)] lg:max-w-none" />
            <div className="min-w-0 lg:mt-[clamp(1.5rem,5vh,3.5rem)]">
              <p className="text-[clamp(1.5rem,6vw,2.25rem)] font-extrabold leading-[1.08] tracking-tight lg:text-[clamp(2.4rem,3.6vw,3.6rem)]">
                Sell where the
                <br />
                work happens.
              </p>
              <p className="mt-3 hidden max-w-md text-sm leading-relaxed text-white/85 sm:block lg:mt-4 lg:text-[clamp(15px,1.15vw,18px)]">
                Call, WhatsApp, meet, and follow up — from one card. The CRM keeps the pipeline up to date for you.
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* form side */}
      <main className="relative flex flex-1 items-start justify-center overflow-hidden px-5 py-8 sm:px-10 sm:py-12 lg:items-center lg:py-10">
        <div className="pointer-events-none absolute -right-48 -top-24 h-[36rem] w-[36rem] rounded-full bg-[#E3EFF8]/70" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-72 -left-24 h-[34rem] w-[60rem] rounded-[50%] bg-[#E8F2FA]/70" aria-hidden="true" />

        <div className="animate-rise relative w-full max-w-[30rem] lg:max-w-[min(36rem,80%)]">
          <div className="hidden lg:block"><Logo /></div>
          <h1 className="text-[clamp(1.9rem,7vw,2.4rem)] font-extrabold tracking-tight text-[#0A2540] lg:mt-[clamp(2rem,7vh,4.5rem)] lg:text-[clamp(2.4rem,3.4vw,3.4rem)]">{title}</h1>
          {subtitle && <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-600 lg:mt-3 lg:text-[clamp(15px,1.2vw,18px)]">{subtitle}</p>}
          <div className="mt-6 lg:mt-[clamp(1.75rem,4vh,2.5rem)]">{children}</div>
          {footer && <div className="mt-6 text-sm text-slate-500">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
