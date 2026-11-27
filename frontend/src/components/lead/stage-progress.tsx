"use client";
import { ArrowLeftRight, Check, Flag, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { PIPELINE_STAGES, STAGE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Pipeline, StageKey } from "@/types/crm";
import { StageIcon } from "./stage-icon";

type Props = {
  stage: StageKey;
  pipeline: Pipeline;
  /** Where a lost lead stopped. Unknown for very old data, in which case every stage may be reopened. */
  lostFrom?: StageKey | null;
  lostReason?: string | null;
  onPick: (s: StageKey) => void;
  onReopen: (s: StageKey) => void;
  onCloseLead: () => void;
};

/**
 * "Step 3 of 7 — Meeting scheduled": the whole road at a glance. Tap a step, or use Change stage.
 * A lost lead shows the road it really travelled (ticks up to where it stopped, then the Lost flag), and can only be
 * reopened at that stage or an earlier one. A won deal is final.
 */
export function StageProgress({ stage, pipeline, lostFrom, lostReason, onPick, onReopen, onCloseLead }: Props) {
  const steps = PIPELINE_STAGES[pipeline] as readonly StageKey[];
  const won = stage === "closed_won";
  const lost = stage === "closed_lost";
  const total = steps.length + 1; // the last step closes the lead
  const [picking, setPicking] = useState(false);

  // How far the lead got: a lost lead's stop (or the whole road when we do not know it), a won deal's full road.
  const stopped = lost ? (lostFrom && steps.includes(lostFrom) ? steps.indexOf(lostFrom) : steps.length - 1) : -1;
  const reach = won ? steps.length : lost ? stopped : steps.indexOf(stage);
  const reopenable = lost ? steps.slice(0, stopped + 1) : [];

  const pick = (s: StageKey | "close") => {
    setPicking(false);
    if (s === "close") onCloseLead();
    else if (lost) onReopen(s);
    else if (s !== stage) onPick(s);
  };

  const heading = won ? (
    <>Deal <span className="font-semibold text-emerald-600">won</span> and paid</>
  ) : lost ? (
    <>
      <span className="font-semibold text-red-600">Lost</span>
      {lostFrom && <> at <span className="font-semibold text-slate-700">{STAGE_LABEL[lostFrom]}</span></>}
      {lostReason && <> · {lostReason}</>}
    </>
  ) : (
    <>Step {reach + 1} of {total} — <span className="font-semibold text-brand">{STAGE_LABEL[stage]}</span></>
  );

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="min-w-0 text-xs font-medium text-slate-500">{heading}</h2>
        {!won && (
          <button type="button" className="pressable inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-brand-soft" onClick={() => setPicking(true)}>
            {lost ? <><RotateCcw className="h-3.5 w-3.5" /> Reopen lead</> : <><ArrowLeftRight className="h-3.5 w-3.5" /> Change stage</>}
          </button>
        )}
      </div>

      {/* the road */}
      <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-0.5">
        {/* every step gets at least 6rem, so long names wrap onto two lines instead of running into the next one */}
        <ol className="relative flex justify-between" style={{ minWidth: `${total * 6}rem` }}>
          <div className="absolute left-[calc(100%/var(--n)/2)] right-[calc(100%/var(--n)/2)] top-3 h-0.5 bg-slate-200" style={{ ["--n" as string]: total }} aria-hidden="true" />
          <div
            className={cn("absolute left-[calc(100%/var(--n)/2)] top-3 h-0.5 transition-[width] duration-500", won ? "bg-emerald-500" : "bg-brand")}
            style={{ ["--n" as string]: total, width: `calc((100% - 100% / ${total}) * ${Math.max(0, Math.min(reach, total - 1)) / (total - 1)})` }}
            aria-hidden="true"
          />
          {[...steps, "close" as const].map((s, i) => {
            const isClose = s === "close";
            const stopHere = lost && i === stopped;
            const done = won ? true : lost ? i < stopped : i < reach;
            const here = !won && !lost && i === reach;
            const never = lost && !isClose && i > stopped; // a stage this lead never reached
            const clickable = !won && !never && (lost ? !isClose : true);
            return (
              <li key={s} className={cn("relative z-10 flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 px-1", never && "opacity-45")}>
                <button
                  type="button"
                  onClick={() => clickable && pick(s)}
                  disabled={!clickable}
                  aria-current={here || stopHere ? "step" : undefined}
                  title={
                    won ? undefined
                      : never ? "Never reached before it was lost"
                      : lost ? (isClose ? "Lost" : `Reopen at ${STAGE_LABEL[s]}`)
                      : isClose ? "Close lead (won or lost)" : here ? "Current stage" : `Move to ${STAGE_LABEL[s]}`
                  }
                  className={cn(
                    "pressable flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors disabled:cursor-default",
                    won && "bg-emerald-500 text-white",
                    isClose && lost && "bg-red-500 text-white",
                    stopHere && "bg-red-500 text-white ring-[3px] ring-red-500/20",
                    !won && !isClose && !stopHere && done && "bg-brand text-white",
                    here && "bg-brand text-white ring-[3px] ring-brand/20",
                    !won && !stopHere && !done && !here && !(isClose && lost) && "border border-slate-300 bg-white text-slate-500",
                    clickable && !done && !here && !stopHere && !isClose && "hover:border-brand hover:text-brand",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : stopHere ? <X className="h-3.5 w-3.5" strokeWidth={3} /> : isClose && lost ? <Flag className="h-3 w-3" /> : i + 1}
                </button>
                <span className={cn("line-clamp-2 max-w-full break-words text-center text-[12px] leading-tight", here ? "font-semibold text-brand" : stopHere || (isClose && lost) ? "font-semibold text-red-600" : isClose && won ? "font-semibold text-emerald-600" : "text-slate-500")}>
                  {isClose ? (won ? "Won" : lost ? "Lost" : "Close lead") : STAGE_LABEL[s]}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <Sheet
        open={picking}
        title={lost ? "Reopen lead" : "Change stage"}
        subtitle={lost ? (lostFrom ? `It was lost at ${STAGE_LABEL[lostFrom]}. Pick it up there, or go back further.` : "Pick the stage to continue from") : "We will ask only for what the stage needs"}
        icon={lost ? RotateCcw : ArrowLeftRight}
        tone="violet"
        onClose={() => setPicking(false)}
      >
        <div className="space-y-2">
          {(lost ? reopenable : steps).map((s, i) => {
            const current = lost ? i === stopped : s === stage;
            return (
              <button key={s} type="button" onClick={() => pick(s)} className={cn("pressable flex w-full items-center gap-3 rounded-2xl border p-3 text-left", current ? (lost ? "border-red-200 bg-red-50/60" : "border-brand bg-brand-soft") : "border-slate-200 hover:bg-slate-50")}>
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", current ? (lost ? "bg-red-500 text-white" : "bg-brand text-white") : "bg-slate-100 text-slate-500")}><StageIcon stage={s} className="h-4 w-4" /></span>
                <span className="flex-1 text-sm font-medium text-slate-800">{i + 1}. {STAGE_LABEL[s]}</span>
                {current && <span className={cn("text-xs font-semibold", lost ? "text-red-600" : "text-brand")}>{lost ? "Lost here" : "Current"}</span>}
              </button>
            );
          })}
          {!lost && (
            <button type="button" onClick={() => pick("close")} className="pressable flex w-full items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-3 text-left hover:bg-slate-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Flag className="h-4 w-4" /></span>
              <span className="flex-1 text-sm font-medium text-slate-800">Close lead (won or lost)</span>
            </button>
          )}
        </div>
      </Sheet>
    </section>
  );
}
