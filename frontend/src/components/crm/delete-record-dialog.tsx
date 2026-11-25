"use client";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorData, statusOf } from "@/lib/api-errors";
import { apiClient, errorMessage } from "@/services/api-client";

type Blocker = { what: string; count: number };

type Props = {
  open: boolean;
  /** What is being deleted, e.g. "lead" or "client". */
  kind: "lead" | "client";
  name: string;
  /** The DELETE endpoint, e.g. /leads/{id}. */
  path: string;
  onClose: () => void;
  onDeleted: () => void;
  /** Leads only: "Close as Lost instead", offered when the lead cannot be deleted. */
  onCloseAsLost?: () => void;
};

/**
 * Delete a lead or a client (soft delete: hidden everywhere, kept in the database). First asks to confirm.
 * When the server refuses because records are connected, the dialog stays open and says exactly what is connected
 * and what to do instead, so the user is never left with a vague error.
 */
export function DeleteRecordDialog({ open, kind, name, path, onClose, onDeleted, onCloseAsLost }: Props) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ message: string; blockers: Blocker[] } | null>(null);

  useEffect(() => { if (open) { setBlocked(null); setBusy(false); } }, [open]);

  if (!open) return null;

  async function remove() {
    setBusy(true);
    try {
      await apiClient.delete(path);
      toast.success(`${name} deleted`);
      onClose();
      onDeleted();
    } catch (e) {
      if (statusOf(e) === 409) {
        setBlocked({ message: errorMessage(e), blockers: errorData<{ blockers?: Blocker[] }>(e)?.blockers ?? [] });
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" role="presentation" onClick={() => !busy && onClose()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-sheet">
        <div className="flex items-start gap-3">
          <span className={blocked ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700" : "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"}>
            {blocked ? <AlertTriangle className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="delete-title" className="text-base font-semibold text-slate-900">
              {blocked ? `This ${kind} can't be deleted` : `Delete ${name}?`}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {blocked
                ? blocked.message
                : kind === "lead"
                  ? "Use this for a lead added by mistake (a duplicate, test data or a wrong entry). It disappears from every list, report and follow-up. It can be restored by an admin from the database if needed."
                  : "Use this for a client added by mistake (a duplicate or test data). It disappears from the client list and its open check-ins are closed. It can be restored by an admin from the database if needed."}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="pressable -mr-1 -mt-1 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>

        {blocked && blocked.blockers.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800">Connected to this {kind}</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
              {blocked.blockers.map((b) => (
                <li key={b.what} className="flex items-center justify-between gap-2"><span>{b.what.charAt(0).toUpperCase() + b.what.slice(1)}</span><b className="font-semibold tabular-nums">{b.count}</b></li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {blocked ? (
            <>
              <Button variant="secondary" onClick={onClose}>OK</Button>
              {kind === "lead" && onCloseAsLost && !blocked.blockers.some((b) => b.what === "won deal") && (
                <Button onClick={() => { onClose(); onCloseAsLost(); }}>Close as Lost instead</Button>
              )}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={() => void remove()} loading={busy}><Trash2 className="h-4 w-4" />Delete {kind}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
