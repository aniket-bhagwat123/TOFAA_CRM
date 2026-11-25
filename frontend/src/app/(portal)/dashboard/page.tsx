"use client";
import { Target, UserPlus } from "lucide-react";
import { useState } from "react";
import { TargetsModal } from "@/components/crm/targets-modal";
import { UserSheet } from "@/components/crm/user-sheet";
import { CompanyDashboard, type CompanyData } from "@/components/dashboard/company-dashboard";
import { ExecutiveDashboard, type ExecutiveData } from "@/components/dashboard/executive-dashboard";
import { FinanceDashboard, type FinanceData } from "@/components/dashboard/finance-dashboard";
import { KamDashboard, type KamData } from "@/components/dashboard/kam-dashboard";
import { TodayPanel } from "@/components/dashboard/today-panel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { useApi } from "@/hooks/use-api";
import { useAppSelector } from "@/store/hooks";

type DashboardData = { role: string } & Partial<CompanyData & ExecutiveData & FinanceData & KamData>;

const INTRO: Record<string, string> = {
  sales_executive: "",
  sales_manager: "Pipeline, target and what needs attention across the company.",
  admin: "",
  finance: "Payments waiting, received this month, and the ERP connection.",
  kam: "Your accounts: revenue, occasions coming up, orders and follow-ups.",
};

/** Every role has its own dashboard, built only from what that role's modules show (see backend dashboard.service). */
export default function DashboardPage() {
  const user = useAppSelector((s) => s.auth.session?.profile);
  const data = useApi<DashboardData>(user ? "/dashboard" : null);
  const [adding, setAdding] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const d = data.data;
  const role = user?.role;

  return (
    <div className={INTRO[role ?? ""] === "" ? "" : "space-y-5"}>
      <PageHeader
        title="Dashboard"
        description={role ? INTRO[role] : undefined}
        actions={
          role === "sales_manager" ? (
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setTargetsOpen(true)}><Target className="h-4 w-4" /> Targets</Button>
              <Button variant="secondary" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" /> Add executive</Button>
            </div>
          ) : undefined
        }
      />
      {data.loading && !d && <div className="flex justify-center py-12"><Spinner /></div>}
      {data.error && !d && <StateView kind="error" message={data.error} onRetry={() => void data.reload()} />}
      {d && (role === "admin" || role === "sales_manager") && <CompanyDashboard d={d as CompanyData} admin={role === "admin"} />}
      {role === "sales_executive" && (
        <div className="space-y-5">
          <TodayPanel />
          {d && <ExecutiveDashboard d={d as ExecutiveData} />}
        </div>
      )}
      {d && role === "finance" && <FinanceDashboard d={d as FinanceData} />}
      {d && role === "kam" && <KamDashboard d={d as KamData} />}
      {role === "sales_manager" && (
        <>
          <TargetsModal open={targetsOpen} onClose={() => setTargetsOpen(false)} onSaved={() => void data.reload()} />
          <UserSheet open={adding} roles={["sales_executive"]} managers={[]} onClose={() => setAdding(false)} onDone={() => void data.reload()} />
        </>
      )}
    </div>
  );
}
