import type { ReactNode } from "react";

/**
 * The module name lives in the top bar, so the title here is only for screen readers.
 * What stays visible is the supporting line and the page's actions.
 */
export const PageHeader = ({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) => (
  <div className={description || actions ? "mb-5 flex flex-wrap items-end justify-between gap-3 md:mb-6" : "sr-only"}>
    <div className="min-w-0">
      <h1 className="sr-only">{title}</h1>
      {description && <p className="text-sm text-slate-500">{description}</p>}
    </div>
    {actions}
  </div>
);
