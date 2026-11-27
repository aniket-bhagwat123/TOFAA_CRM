"use client";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { apiClient, errorMessage } from "@/services/api-client";
import { DeleteDialog } from "./delete-dialog";

export type DeleteRequest = { path: string; title: string; message: string; done: string };

/** Ask first, then call the DELETE endpoint. When the server refuses, its reason is shown. Render `dialog` once. */
export function useDelete(onDeleted: () => void): { ask: (r: DeleteRequest) => void; dialog: ReactNode } {
  const [target, setTarget] = useState<DeleteRequest | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!target) return;
    setBusy(true);
    try {
      await apiClient.delete(target.path);
      toast.success(target.done);
      onDeleted();
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  const dialog = <DeleteDialog open={!!target} title={target?.title ?? ""} message={target?.message ?? ""} loading={busy} onConfirm={() => void confirm()} onCancel={() => setTarget(null)} />;
  return { ask: setTarget, dialog };
}
