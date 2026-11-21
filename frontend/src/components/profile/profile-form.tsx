"use client";
import { Camera, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { setProfile } from "@/features/auth/auth.slice";
import { removePhoto, uploadPhoto } from "@/features/media/upload";
import { ACCEPT_ATTR, prepareImage } from "@/lib/image";
import { errorMessage } from "@/services/api-client";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { ROLE_LABEL } from "@/types/api";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { InputField } from "../ui/input-field";

/** Your details, and your own profile photo (saved the moment you choose it). */
export function ProfileForm() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const dispatch = useAppDispatch();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const name = user.fullName ?? user.email ?? "Me";

  async function choose(file?: File) {
    if (!file || !user) return;
    setBusy(true);
    try {
      const url = await uploadPhoto("/users/me/avatar", await prepareImage(file));
      dispatch(setProfile({ ...user, avatarUrl: url }));
      toast.success("Photo updated");
    } catch (e) {
      toast.error(e instanceof Error && !("response" in e) ? e.message : errorMessage(e, "Could not upload the photo."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!user) return;
    setBusy(true);
    try {
      await removePhoto("/users/me/avatar");
      dispatch(setProfile({ ...user, avatarUrl: null }));
      toast.success("Photo removed");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="h-full space-y-5">
      <div className="flex items-center gap-4">
        <Avatar src={user.avatarUrl} name={name} size="xl" />
        <div className="space-y-2">
          <input ref={input} type="file" accept={ACCEPT_ATTR} hidden onChange={(e) => void choose(e.target.files?.[0])} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}><Camera className="h-4 w-4" /> {user.avatarUrl ? "Change photo" : "Upload photo"}</Button>
            {user.avatarUrl && <Button variant="ghost" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" /> Remove</Button>}
          </div>
          <p className="text-xs text-slate-500">JPEG, PNG or WebP.</p>
        </div>
      </div>
      <InputField label="Name" value={user.fullName ?? ""} readOnly />
      <InputField label="Email" value={user.email ?? ""} readOnly />
      <InputField label="Mobile" value={user.phone ?? ""} readOnly />
      <InputField label="Role" value={ROLE_LABEL[user.role]} readOnly />
    </Card>
  );
}
