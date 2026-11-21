"use client";
import { Button } from "./button";

type Props = { open: boolean; title: string; message: string; loading?: boolean; onConfirm: () => void; onCancel: () => void };

export function DeleteDialog({ open, title, message, loading, onConfirm, onCancel }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>Delete</Button>
        </div>
      </div>
    </div>
  );
}
