"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OccasionCalendarTab } from "@/components/clients/occasion-calendar-tab";
import { QuotationTemplateTab } from "@/components/crm/quotation-template-tab";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InputField, TextareaField } from "@/components/ui/input-field";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { useApi } from "@/hooks/use-api";
import { fieldErrors } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import type { StageConfig } from "@/types/crm";

type Usage = { month: string; apiEnabled: boolean; messagesOut: number; messagesIn: number; clickToChatSent: number; conversations: number; estimatedCost: number };
type Template = { id: string; name: string; purpose: string; body: string; approved: boolean };
const TABS = ["Pipeline", "Quotation", "Occasions", "WhatsApp"] as const; // people are managed in Users

function PipelineTab() {
  const stages = useApi<StageConfig[]>("/stages");
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function save(stage: string) {
    try {
      await apiClient.patch(`/stages/${stage}`, { probability: Number(edits[stage]) });
      toast.success("Saved");
      setEdits(({ [stage]: _, ...rest }) => rest);
      void stages.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card className="space-y-3">
      <p className="text-sm text-slate-500">Starting probabilities. Replace them with real conversion data after about 3 months.</p>
      {(stages.data ?? []).map((s) => (
        <div key={s.stage} className="flex items-center justify-between gap-3">
          <span className="text-sm">{s.label}</span>
          <div className="flex items-center gap-2">
            <input
              type="number" min={0} max={100}
              value={edits[s.stage] ?? String(s.probability)}
              onChange={(e) => setEdits((x) => ({ ...x, [s.stage]: e.target.value }))}
              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
            />
            <span className="text-sm text-slate-500">%</span>
            <Button variant="secondary" className="px-3 py-1 text-xs" disabled={edits[s.stage] === undefined} onClick={() => save(s.stage)}>Save</Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function WhatsAppTab() {
  const usage = useApi<Usage>("/whatsapp/usage");
  const templates = useApi<Template[]>("/whatsapp/templates");
  const [form, setForm] = useState({ name: "", purpose: "follow_up", body: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function add() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Template name is required";
    else if (!/^[a-z0-9_]+$/.test(form.name)) e.name = "Use lowercase letters, numbers and underscores only";
    if (!form.body.trim()) e.body = "Message is required";
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      await apiClient.post("/whatsapp/templates", form);
      setForm({ name: "", purpose: "follow_up", body: "" });
      setErrors({});
      void templates.reload();
    } catch (e) {
      const fe = fieldErrors(e);
      Object.keys(fe).length ? setErrors(fe) : toast.error(errorMessage(e));
    }
  }
  async function approve(t: Template) {
    await apiClient.patch(`/whatsapp/templates/${t.id}`, { approved: !t.approved });
    void templates.reload();
  }

  const u = usage.data;
  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h3 className="font-medium">Usage · {u?.month}</h3>
        {u && (
          <>
            <p className={cn("text-sm", u.apiEnabled ? "text-emerald-700" : "text-amber-700")}>
              {u.apiEnabled ? "WhatsApp Business API is connected." : "API not connected yet. Executives use click-to-chat."}
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><div className="text-xs text-slate-400">Conversations</div><div className="text-lg font-semibold">{u.conversations}</div></div>
              <div><div className="text-xs text-slate-400">Sent / received</div><div className="text-lg font-semibold">{u.messagesOut} / {u.messagesIn}</div></div>
              <div><div className="text-xs text-slate-400">Click-to-chat</div><div className="text-lg font-semibold">{u.clickToChatSent}</div></div>
              <div><div className="text-xs text-slate-400">Estimated cost</div><div className="text-lg font-semibold">₹{u.estimatedCost}</div></div>
            </div>
          </>
        )}
      </Card>
      <Card className="space-y-3">
        <h3 className="font-medium">Templates</h3>
        <p className="text-xs text-slate-500">Create the template here, submit the same text to Meta, then tick Approved once Meta approves it.</p>
        {(templates.data ?? []).map((t) => (
          <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <div className="min-w-0"><div className="font-medium">{t.name} <span className="text-xs text-slate-400">· {t.purpose.replaceAll("_", " ")}</span></div><p className="text-slate-600">{t.body}</p></div>
            <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={t.approved} onChange={() => approve(t)} className="accent-violet-600" /> Approved</label>
          </div>
        ))}
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <InputField label="Template name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
            <SelectField label="Purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              options={["first_contact", "meeting_reminder", "follow_up", "quotation_sent", "payment_reminder", "other"].map((p) => ({ value: p, label: p.replaceAll("_", " ") }))} />
          </div>
          <TextareaField label="Message" required placeholder="Write the message" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} error={errors.body} />
          <Button onClick={add}>Add template</Button>
        </div>
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  const role = useAppSelector((s) => s.auth.session?.profile.role);
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Pipeline");
  useEffect(() => { if (role && role !== "admin") router.replace("/today"); }, [role, router]);
  if (role !== "admin") return null;
  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("flex-1 rounded-md px-3 py-1.5 font-medium", tab === t ? "bg-white shadow-sm" : "text-slate-500")}>{t}</button>
        ))}
      </div>
      {tab === "Pipeline" && <PipelineTab />}
      {tab === "Quotation" && <QuotationTemplateTab />}
      {tab === "Occasions" && <OccasionCalendarTab />}
      {tab === "WhatsApp" && <WhatsAppTab />}
    </div>
  );
}
