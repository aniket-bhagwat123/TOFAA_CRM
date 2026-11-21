"use client";
import { KeyRound, Pencil, UserCheck, UserPlus, UserX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UserSheet, type UserRow } from "@/components/crm/user-sheet";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { Spinner } from "@/components/ui/spinner";
import { StateView } from "@/components/ui/state-view";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { useApi } from "@/hooks/use-api";
import { cn } from "@/lib/utils";
import { apiClient, errorMessage } from "@/services/api-client";
import { useAppSelector } from "@/store/hooks";
import { ROLE_LABEL, type Role } from "@/types/api";

const ROLES: Role[] = ["sales_executive", "sales_manager", "finance", "kam", "admin"];
const ROLE_TONE: Record<Role, string> = {
  admin: "bg-slate-900 text-white",
  sales_manager: "bg-brand-soft text-brand",
  sales_executive: "bg-sky-50 text-sky-700",
  finance: "bg-emerald-50 text-emerald-700",
  kam: "bg-amber-50 text-amber-700",
};
const iconButton = "pressable inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900";
const select = "h-10 w-full shrink-0 truncate rounded-xl border border-slate-300/80 bg-white px-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 sm:w-44";
const shownPhone = (p?: string | null) => (p ? p.replace(/^\+91/, "") : "—");

/** Everyone who signs in: add them (with a password to hand over), edit, set a new password, switch off. Admin only. */
export default function UsersPage() {
  const router = useRouter();
  const me = useAppSelector((s) => s.auth.session?.profile);
  const users = useApi<UserRow[]>(me?.role === "admin" ? "/users" : null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [sheet, setSheet] = useState<{ user: UserRow | null; password?: boolean } | null>(null);

  useEffect(() => { if (me && me.role !== "admin") router.replace("/"); }, [me, router]);

  const all = users.data ?? [];
  const managers = all.filter((u) => u.role === "sales_manager" && u.isActive).map((u) => ({ id: u.id, name: u.fullName ?? u.email ?? u.id }));
  const nameOf = (id?: string | null) => all.find((u) => u.id === id)?.fullName ?? "—";
  const rows = useMemo(() => {
    const t = search.trim().toLowerCase();
    return all.filter((u) =>
      (!t || [u.fullName, u.email, u.phone].some((x) => x?.toLowerCase().includes(t))) &&
      (!role || u.role === role) &&
      (!status || (status === "active" ? u.isActive : !u.isActive)));
  }, [all, search, role, status]);
  const activeCount = all.filter((u) => u.isActive).length;
  const filtering = !!(search || role || status);

  async function setActive(u: UserRow, isActive: boolean) {
    try {
      await apiClient.patch(`/users/${u.id}`, { isActive });
      toast.success(isActive ? `${u.fullName} can sign in again` : `${u.fullName} can no longer sign in`);
      void users.reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (me?.role !== "admin") return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Users" />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="sm:w-60" value={search} onChange={setSearch} placeholder="Search name, email or mobile" />
        <select className={select} value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <select className={select} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="">Active and inactive</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {filtering && (
          <button type="button" onClick={() => { setSearch(""); setRole(""); setStatus(""); }} className="pressable inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <X className="h-4 w-4" /> Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {users.data && <span className="hidden text-sm text-slate-500 md:inline">{activeCount} active · {all.length - activeCount} inactive</span>}
          <Button onClick={() => setSheet({ user: null })}><UserPlus className="h-4 w-4" /> Add user</Button>
        </div>
      </div>

      {users.loading && !users.data ? (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      ) : users.error && !users.data ? (
        <StateView kind="error" message={users.error} onRetry={() => void users.reload()} />
      ) : rows.length === 0 ? (
        <StateView
          kind="empty"
          title={filtering ? "Nobody matches" : "No users yet"}
          message={filtering ? "Try a different search or clear the filters." : "Add the first person to get started."}
          action={filtering ? undefined : <Button onClick={() => setSheet({ user: null })}><UserPlus className="h-4 w-4" /> Add user</Button>}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">User</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Reports to</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-px pr-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const self = u.id === me.id;
                  return (
                    <TableRow key={u.id} className={cn(!u.isActive && "bg-slate-50/60")}>
                      <TableCell className="pl-4">
                        <div className={cn("flex max-w-[22rem] items-center gap-3", !u.isActive && "opacity-60")}>
                          <Avatar src={u.avatarUrl} name={u.fullName} size="sm" />
                          <div className="min-w-0">
                            <div className="t-body truncate font-semibold text-slate-900">{u.fullName || "—"}{self && <span className="ml-1.5 text-xs font-medium text-slate-400">(you)</span>}</div>
                            <div className="t-meta truncate">{u.email || "No email"}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><span className="t-body tabular-nums text-slate-700">{shownPhone(u.phone)}</span></TableCell>
                      <TableCell><span className={cn("whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", ROLE_TONE[u.role])}>{ROLE_LABEL[u.role]}</span></TableCell>
                      <TableCell><span className="t-body block max-w-[10rem] truncate text-slate-700">{u.role === "sales_executive" ? nameOf(u.managerId) : "—"}</span></TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", u.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-200/70 text-slate-600")}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", u.isActive ? "bg-emerald-500" : "bg-slate-400")} />
                          {u.isActive ? "Active" : "Inactive"}
                        </span>
                      </TableCell>
                      <TableCell className="pr-4">
                        <div className="-ml-2 flex items-center gap-0.5">
                          <Tooltip label="Edit">
                            <button type="button" aria-label={`Edit ${u.fullName}`} onClick={() => setSheet({ user: u })} className={iconButton}><Pencil className="h-4 w-4" /></button>
                          </Tooltip>
                          <Tooltip label="Set a new password">
                            <button type="button" aria-label={`Set a new password for ${u.fullName}`} onClick={() => setSheet({ user: u, password: true })} className={iconButton}><KeyRound className="h-4 w-4" /></button>
                          </Tooltip>
                          <Tooltip label={self ? "You cannot switch yourself off" : u.isActive ? "Deactivate" : "Activate"}>
                            <button
                              type="button"
                              disabled={self}
                              aria-label={u.isActive ? `Deactivate ${u.fullName}` : `Activate ${u.fullName}`}
                              onClick={() => void setActive(u, !u.isActive)}
                              className={cn(iconButton, "disabled:pointer-events-none disabled:opacity-35", u.isActive ? "hover:text-red-600" : "hover:text-emerald-600")}
                            >
                              {u.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            </button>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <UserSheet
        open={!!sheet}
        user={sheet?.user}
        startWithPassword={!!sheet?.password}
        roles={ROLES}
        managers={managers}
        onClose={() => setSheet(null)}
        onDone={() => void users.reload()}
      />
    </div>
  );
}
