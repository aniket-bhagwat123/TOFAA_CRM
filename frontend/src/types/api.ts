export type Role = "admin" | "sales_manager" | "finance" | "kam";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  sales_manager: "Sales Manager",
  finance: "Finance",
  kam: "Key Account Manager",
};

export type Profile = {
  id: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  role: Role;
  managerId?: string | null;
  avatarUrl?: string | null;
};

export type Tokens = { accessToken: string; refreshToken: string; expiresIn?: number };
export type Session = { profile: Profile; tokens: Tokens };

export type Page<T> = { items: T[]; page: number; limit: number; total: number; pages: number };
/** What the CRM list endpoints return: items plus paging info. */
export type Paged<T> = { items: T[]; meta: { page: number; limit: number; total: number; pages: number } };
export type ApiRecord = Record<string, unknown> & { id: string; version?: number };
