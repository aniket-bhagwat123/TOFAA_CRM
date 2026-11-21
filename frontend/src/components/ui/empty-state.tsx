import type { ReactNode } from "react";
import { StateView } from "./state-view";

/** "No data found" with a picture. Pass `action` for the obvious next step (for example Add lead). */
export const EmptyState = ({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) => (
  <StateView kind="empty" title={title} message={hint} action={action} />
);
