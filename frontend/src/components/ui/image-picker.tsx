"use client";
import { Camera, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ACCEPT_ATTR, prepareImage } from "@/lib/image";
import { Avatar } from "./avatar";
import { Button } from "./button";

type Props = {
  label: string;
  name?: string | null; // for the initials shown until a photo is chosen
  file: File | null;
  onChange: (file: File | null) => void;
  existingUrl?: string | null;
  hint?: string;
  square?: boolean;
};

/** Pick a photo (camera or gallery on phones). It is resized here; the parent decides when to upload. */
export function ImagePicker({ label, name, file, onChange, existingUrl, hint, square }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await prepareImage(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not use that image.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const shown = preview ?? existingUrl ?? null;
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-4">
        <Avatar src={shown} name={name} size="xl" square={square} />
        <div className="space-y-2">
          <input ref={input} type="file" accept={ACCEPT_ATTR} hidden onChange={(e) => void pick(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              <Camera className="h-4 w-4" /> {shown ? "Change" : "Upload photo"}
            </Button>
            {file && (
              <Button type="button" variant="ghost" onClick={() => onChange(null)}>
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">{hint ?? "JPEG, PNG or WebP. Optional."}</p>
        </div>
      </div>
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}
