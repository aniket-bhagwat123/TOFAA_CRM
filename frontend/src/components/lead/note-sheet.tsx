"use client";
import { StickyNote } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { apiClient, errorMessage } from "@/services/api-client";
import { VoiceTextarea } from "../crm/voice-textarea";

/** A free note on a lead (voice-to-text on phones). It shows in Activity. */
export function NoteSheet({ leadId, name, open, onClose, onSaved }: { leadId: string; name?: string; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) { setNote(""); setError(undefined); } }, [open]);

  async function save() {
    if (!note.trim()) return setError("Write the note first");
    setBusy(true);
    try {
      await apiClient.post(`/leads/${leadId}/notes`, { note: note.trim() });
      toast.success("Note saved");
      onClose();
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} title="Add a note" subtitle={name} icon={StickyNote} tone="amber" onClose={onClose}>
      <div className="space-y-4">
        <VoiceTextarea label="Note" value={note} onChange={(v) => { setNote(v); setError(undefined); }} rows={4} />
        {error && <p role="alert" className="-mt-2 text-xs font-medium text-red-600">{error}</p>}
        <Button onClick={save} loading={busy} className="w-full">Save note</Button>
      </div>
    </Sheet>
  );
}
