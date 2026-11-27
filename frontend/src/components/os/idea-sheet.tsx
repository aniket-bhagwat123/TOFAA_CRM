"use client";
import { Gift } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { InputField } from "@/components/ui/input-field";
import { SelectField } from "@/components/ui/select-field";
import { Sheet } from "@/components/ui/sheet";
import { apiClient, errorMessage } from "@/services/api-client";
import type { GiftIdea } from "@/types/os-modules";

/** The categories Gifting OS offers. */
export const IDEA_CATEGORIES = ["Festive", "Social & Family", "National & Wellness", "Corporate", "Professional Days", "Police & Armed Forces", "Seasonal Gifting", "Corporate Milestones", "Employee Life Events", "Client & Partner Moments", "Social & Personal", "PR & Brand Gifting"];

type Form = { occasion: string; giftIdea: string; category: string; giftTo: string; fixedDate: boolean; startDate: string; endDate: string; isActive: boolean };
const BLANK: Form = { occasion: "", giftIdea: "", category: "", giftTo: "", fixedDate: true, startDate: "", endDate: "", isActive: true };
const check = "h-4 w-4 rounded border-slate-300 text-brand";

/** Add or edit one gift idea (admin). The same fields and rules as Gifting OS. */
export function IdeaSheet({ idea, onClose, onSaved }: { idea: GiftIdea | "new" | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(BLANK);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);
  const editing = idea && idea !== "new" ? idea : null;

  useEffect(() => {
    if (!idea) return;
    setErrors({});
    setForm(idea === "new" ? BLANK : {
      occasion: idea.occasion, giftIdea: idea.giftIdea, category: idea.category ?? "", giftTo: idea.giftTo.join(", "),
      fixedDate: !!idea.startDate, startDate: idea.startDate ?? "", endDate: idea.endDate ?? "", isActive: idea.isActive,
    });
  }, [idea]);
  const set = (patch: Partial<Form>) => { setForm((c) => ({ ...c, ...patch })); setErrors({}); };

  async function save() {
    const found: typeof errors = {};
    const giftTo = form.giftTo.split(",").map((x) => x.trim()).filter(Boolean);
    if (!form.occasion.trim()) found.occasion = "Enter the occasion.";
    if (!form.giftIdea.trim()) found.giftIdea = "Enter what to gift.";
    if (giftTo.length > 20 || giftTo.some((x) => x.length > 120)) found.giftTo = "Up to 20 entries, each under 120 characters.";
    if (form.fixedDate && !form.startDate) found.startDate = "Pick the date.";
    if (form.fixedDate && form.endDate && form.endDate < form.startDate) found.endDate = "The end date is before the start date.";
    if (Object.keys(found).length) return setErrors(found);
    setBusy(true);
    try {
      const body = {
        occasion: form.occasion.trim(), giftIdea: form.giftIdea.trim(), category: form.category || null, giftTo,
        startDate: form.fixedDate ? form.startDate : null, endDate: form.fixedDate && form.endDate ? form.endDate : null, isActive: form.isActive,
      };
      await (editing ? apiClient.patch(`/os/gift-ideas/${editing.id}`, body) : apiClient.post("/os/gift-ideas", body));
      toast.success(editing ? "Gift idea updated" : "Gift idea added");
      onClose();
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!idea} title={editing ? "Edit gift idea" : "Add gift idea"} subtitle="Clients see active ideas in Gifting OS" icon={Gift} tone="violet" onClose={onClose} width="lg">
      <div className="space-y-4">
        <InputField label="Occasion" required maxLength={150} value={form.occasion} error={errors.occasion} onChange={(e) => set({ occasion: e.target.value })} placeholder="Enter occasion" />
        <InputField label="Gift idea" required maxLength={300} value={form.giftIdea} error={errors.giftIdea} onChange={(e) => set({ giftIdea: e.target.value })} placeholder="Enter what to gift" />
        <InputField label="Gift to (optional)" value={form.giftTo} error={errors.giftTo} onChange={(e) => set({ giftTo: e.target.value })} placeholder="Who to gift, separated by commas" />
        <SelectField label="Category (optional)" value={form.category} options={[{ value: "", label: "No category" }, ...IDEA_CATEGORIES.map((c) => ({ value: c, label: c }))]} onChange={(e) => set({ category: e.target.value })} />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" className={check} checked={form.fixedDate} onChange={(e) => set({ fixedDate: e.target.checked })} />This idea has a date</label>
        {form.fixedDate && (
          <div className="grid gap-3 sm:grid-cols-2">
            <DatePicker label="Date" required value={form.startDate} error={errors.startDate} onChange={(startDate) => set({ startDate })} />
            <DatePicker label="End date (optional)" min={form.startDate || undefined} value={form.endDate} error={errors.endDate} onChange={(endDate) => set({ endDate })} />
          </div>
        )}
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 px-4 py-3">
          <input type="checkbox" className={`${check} mt-0.5`} checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          <span><span className="block text-sm font-medium text-slate-800">Show to clients</span><span className="block text-xs text-slate-500">Turn this off to keep the idea hidden while you work on it.</span></span>
        </label>
        <Button className="w-full" loading={busy} onClick={() => void save()}>{editing ? "Save changes" : "Add gift idea"}</Button>
      </div>
    </Sheet>
  );
}
