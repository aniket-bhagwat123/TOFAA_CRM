# People Module + Banner Module — Build Spec

This file describes how the **People** (recipients + groups) and **Banner** modules work in TOFAA Gifting OS,
across database, backend and frontend, so you can rebuild them in a new project with the same flow.

It assumes the new project uses the layout in `PROJECT_STRUCTURE.md`:
**Next.js 15 frontend + FastAPI backend + Supabase**. Paths below are relative to the repo root.

> **How to use this file in the new project:** build in the order given in section 4 (People) and section 3 (Banners).
> Each step lists the files to create, what they contain, and the rules they must follow.

---

## 1. Shared pieces both modules need (build these first)

These already exist in the current project. If the new project does not have them, create them first.

### Backend (`backend/src/core/`)

| File | What the modules use from it |
|---|---|
| `schema.py` | `ApiResponse[T]` envelope `{ data, message }` and `to_camel` alias generator (JSON is camelCase, Python is snake_case). |
| `pagination.py` | `PaginationMeta(page, limit, total_records)` and `next_page_cursor(page, limit, total)`. |
| `supabase.py` | `get_supabase_admin_client()`: the service-role client. It bypasses RLS, so **every query must filter by `tenant_id`**. |
| `errors.py` | `ApiError(status, message, data)`: an error that still carries data (used for 409 duplicates / version conflicts). |
| `images.py` | `store_image(db, folder, content, content_type, max_bytes, aspect_ratio, min_width)` → public URL; `remove_image(db, url)`. Uses the public Storage bucket `images`. Checks the MIME type, the file's magic bytes, size, and (for banners) the aspect ratio read from the file header. |
| `ttl_cache.py` | `lookups.get(key, seconds)` / `lookups.set(key, value)`, plus the `MISSING` sentinel. A small in-memory cache. |
| `concurrency.py` | `run_parallel(*fns)`: runs independent lookups side by side (used to enrich the recipient list). |

### Backend auth (`backend/src/modules/auth/`)

- `dependencies.py` → `CurrentUserDep` (validates the Bearer JWT and returns `UserProfileResponse` with `id`, `role`, `tenant`).
- `authorization.py` → `SuperAdminDep = Annotated[UserProfileResponse, Depends(require_roles(Role.SUPER_ADMIN))]`.
- `rbac.py` → `Role` enum (`CLIENT`, `KAM`/TOFAA team, `SUPER_ADMIN`), `Permission` enum, `require_permission(actor, perm)`.
  Add these permissions and give them to client users and staff:
  `RECIPIENT_READ, RECIPIENT_CREATE, RECIPIENT_UPDATE, RECIPIENT_DELETE, RECIPIENT_RESTORE` (`"recipient:read"` etc.),
  plus `GIFT_SPEND_READ, GIFT_SPEND_MANAGE` for groups.
- `modules/tenants/service.py` → `tenant_service.require_access(tenant_id, actor)`: a client may only touch their own tenant; staff may touch any.
- `modules/tenants/guard.py` → `enforce_tenant_scope`: router-level dependency that checks the `{tenant_id}` in the URL.

### Database helpers

- `public.handle_updated_at()` trigger function (sets `updated_at = now()`).
- `public.tenants`, `public.profiles` tables.
- Storage bucket `images` (public read; writes go only through the API).

### Frontend

| File | Role |
|---|---|
| `src/services/api-client.ts` | axios instance: base URL `NEXT_PUBLIC_API_BASE_URL + /api/v1`, Bearer token, refresh on 401. Exports `api`, `getApiErrorMessage(err)`. |
| `src/features/modules/module.service.ts` | `getModuleRecords(endpoint, params, { ttl })` for GET (dedupes in-flight calls, optional TTL cache, unwraps `data`). `mutateModule(method, endpoint, body, params, headers)` for writes (clears the cache after every write). |
| `src/features/modules/module-utils.ts` | `loadAllModuleRecords(endpoint)` (walks every page), `rowsOf(data)` (returns `data.items`). |
| `src/features/modules/module-config.ts` | Registry of modules: roles, title, endpoint, columns, create/update fields. Drives the sidebar, the route guard and the generic list page. |
| `src/app/(portal)/[module]/page.tsx` | Generic page: looks up `moduleConfig[module]` and renders `ModuleGate` → `ModuleList`. |
| `src/components/modules/module-list.tsx` | Generic table + create/edit/delete form, driven by config. |
| `src/components/ui/image-upload.tsx` | `sendImage(method, url, file, params?)`: sends the **raw file as the request body** with `Content-Type: file.type`, 60s timeout. Also `ImageUpload` and `deleteImage`. |
| `src/components/ui/*` | `Button`, `Sheet`, `FormPanel`, `DeleteDialog`, `FilterMenu`, `FormatMenu`, `SearchInput`, `TabBar/Tab`, `Popover`, `DatePickerField`, `Spinner`, `table-styles`. |
| `src/lib/data-io.ts` | `readTable(file)` / `writeTable(headers, rows, format, name)` for CSV/XLSX import and export. |

Tenant selection on the frontend: a `CLIENT` always uses `user.tenant.id`; staff use `state.modules.selectedTenantId`
(the "Viewing" menu in the top bar). `module-config.ts` has the helper:

```ts
const requireTenant = (user: AuthUser, selectedTenantId?: string | null) => {
  const id = user.platformRole === "CLIENT" ? user.tenant?.id : selectedTenantId;
  if (!id) throw new Error(user.platformRole === "CLIENT"
    ? "Your account isn't linked to an active organisation yet. Please contact TOFAA to get this fixed."
    : "Choose a client from the “Viewing” menu at the top first.");
  return id;
};
```

---

## 2. End-to-end flow (both modules)

```text
Page (src/app/(portal)/...)               thin: renders one Gate component
  -> Gate component                       checks moduleConfig[key].roles against user.platformRole
  -> View / Panel / Sheet component       state, filters, forms
  -> getModuleRecords / mutateModule / sendImage
  -> api-client (adds /api/v1 + Bearer)
  -> FastAPI router.py                    HTTP only: parse path/query/body, auth dependency, call service
  -> service.py                           permission check, tenant check, queries, storage
  -> Supabase (service-role client)       Postgres tables / RPC / Storage bucket "images"
  <- { "data": ..., "message": "..." }
```

Rules that hold in both modules:
- `router.py` never touches the database. `service.py` holds all permission checks and queries.
- Every recipient query has `.eq("tenant_id", tenant_id).is_("deleted_at", "null")`.
- All tables have RLS **enabled with no policies** and grants only to `service_role`: the browser can never read them directly.
- Pictures are uploaded as a raw body (not multipart), validated server-side, stored in bucket `images`, and the old file is removed after a successful replace.

---

## 3. Banner module

### 3.1 What it does

- A banner is **just a picture** with the shape 1000 × 90 (any size with that ratio within 2%, at least 500 px wide, PNG/JPEG/WebP, up to 5 MB).
- Super admins add, reorder, schedule (start/end date), target (`ALL` / `CLIENT` / `STAFF`) and switch banners on or off.
- Every signed-in user sees the live banners as a rotating carousel at the top of the Home dashboard.
- Banners are platform-wide (not per tenant), so the router sits **outside** the tenant guard.

### 3.2 Database — `supabase/migrations/<ts>_dashboard_banners.sql`

Final schema (one migration for a new project):

```sql
create table if not exists public.dashboard_banners (
    id uuid primary key default gen_random_uuid(),
    audience text not null default 'ALL' check (audience in ('ALL', 'CLIENT', 'STAFF')),
    image_url text not null check (image_url ~ '^https://'),
    sort_order integer not null default 0 check (sort_order between 0 and 9999),
    is_active boolean not null default true,
    starts_on date,
    ends_on date,
    created_by_user_id uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint dashboard_banners_dates_ck check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists dashboard_banners_active_idx
    on public.dashboard_banners(sort_order) where is_active;
drop trigger if exists dashboard_banners_updated_at on public.dashboard_banners;
create trigger dashboard_banners_updated_at before update on public.dashboard_banners
    for each row execute function public.handle_updated_at();
-- The API uses the service role. RLS on with no policies = no direct browser access.
alter table public.dashboard_banners enable row level security;
```

### 3.3 Backend — `backend/src/modules/banners/`

```
banners/
├── __init__.py
├── schemas.py
├── service.py
└── router.py
```

**schemas.py**

```python
Audience = Literal["ALL", "CLIENT", "STAFF"]

class BannerCreate(BaseModel):          # sent as QUERY params next to the raw image body
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")
    audience: Audience = "ALL"
    sort_order: int = Field(default=0, ge=0, le=9999)
    is_active: bool = True
    starts_on: date | None = None
    ends_on: date | None = None
    # model_validator: ends_on >= starts_on -> "The end date is before the start date."

class BannerUpdate(BaseModel):          # JSON body for PATCH; all optional
    # same fields, all Optional; validator:
    #  - at least one field set ("At least one banner field must be provided")
    #  - audience / sort_order / is_active may not be sent as null
    #  - ends_on >= starts_on

class BannerRead(BaseModel):
    id: str; audience: Audience; image_url: str; sort_order: int = 0; is_active: bool = True
    starts_on: date | None; ends_on: date | None; created_at: datetime | None; updated_at: datetime | None

class BannerList(BaseModel):
    items: list[BannerRead]; pagination: PaginationMeta; next_cursor: str | None = None
```

**service.py** — key logic

```python
COLUMNS = "id,audience,image_url,sort_order,is_active,starts_on,ends_on,created_at,updated_at"
MAX_LIVE = 50
BANNER_RATIO = (1000, 90)
BANNER_MIN_WIDTH = 500

def is_live(row, today):        # active AND starts_on <= today <= ends_on (each optional)
def audience_allows(audience, actor):
    return audience == "ALL" or (audience == "CLIENT") == (actor.role == Role.CLIENT)

class BannerService:
    def live(actor):            # cached under ("banners-live",) for AUTH_CACHE_SECONDS;
                                # select is_active=True order by sort_order, created_at limit 50;
                                # then filter is_live(today) and audience_allows(actor) in Python
    def manage_list(page, limit)  # select count="exact", order sort_order, created_at, range(offset, offset+limit-1)
    def get(id)                   # 404 "Banner not found."
    def create(payload, actor, content, content_type):
        url = _store(uuid4().hex, content, content_type)     # upload first
        insert payload + image_url + created_by_user_id
        if insert fails -> images.remove_image(url) and re-raise   # never leave an orphan file
    def update(id, payload)       # check exists, update(model_dump(exclude_unset=True))
    def delete(id)                # delete row, then remove_image(old url)
    def set_image(id, content, content_type)  # store new, update row, remove old
    def _store(folder, content, content_type):
        return images.store_image(db, f"banners/{folder}", content, content_type,
            max_bytes=images.PHOTO_MAX_BYTES, aspect_ratio=BANNER_RATIO, min_width=BANNER_MIN_WIDTH)
```

> Note: the `banners-live` cache should be cleared on create/update/delete/set_image so a change shows straight away
> (or keep the TTL short). The frontend also caches the list for 60 s.

**router.py** — endpoints

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/banners` | `CurrentUserDep` | – | Live banners for this user. Returns `list[BannerRead]`. |
| GET | `/admin/banners?page&limit` | `SuperAdminDep` | – | `BannerList`, ordered by `sort_order`. |
| POST | `/admin/banners?audience&sort_order&is_active&starts_on&ends_on` | `SuperAdminDep` | **raw image bytes** | `201`, `ApiResponse[BannerRead]`, "Banner created." |
| GET | `/admin/banners/{id}` | `SuperAdminDep` | – | `BannerRead` |
| PATCH | `/admin/banners/{id}` | `SuperAdminDep` | JSON `BannerUpdate` | "Banner updated." |
| DELETE | `/admin/banners/{id}` | `SuperAdminDep` | – | "Banner deleted." |
| PUT | `/admin/banners/{id}/image` | `SuperAdminDep` | **raw image bytes** | Replace the picture. "Image saved." |

Raw-body upload pattern (used by both modules):

```python
@router.post("/admin/banners", response_model=ApiResponse[BannerRead], status_code=201)
async def create_banner(request: Request, actor: SuperAdminDep,
                        audience: Annotated[Audience, Query()] = "ALL",
                        sort_order: Annotated[int, Query(ge=0, le=9999)] = 0,
                        is_active: bool = True, starts_on: date | None = None, ends_on: date | None = None):
    payload = BannerCreate(audience=audience, sort_order=sort_order, is_active=is_active,
                           starts_on=starts_on, ends_on=ends_on)
    data = await run_in_threadpool(banner_service.create, payload, actor,
        content=await request.body(), content_type=request.headers.get("content-type", ""))
    return ApiResponse(data=data, message="Banner created.")
```

**Mounting** in `backend/src/api/router.py` — **outside** the tenant guard:

```python
from src.modules.banners.router import router as banners_router
# Banners are platform-wide (not tied to a client), so they sit outside the tenant guard.
api_router.include_router(banners_router)
```

**Tests** — `backend/tests/unit/banners/test_banners.py`: `is_live` date window, `audience_allows` per role,
schema date validation, update with no fields → error, create removes the stored image when the insert fails.

### 3.4 Frontend

#### a) Admin screen — config-driven (no custom page)

In `src/features/modules/module-config.ts`:

```ts
const bannerFields: ModuleField[] = [
  { name: "image", label: "Banner picture", type: "image",
    hint: "PNG, JPG or WebP, up to 5 MB. Any size with the 1000 × 90 shape, for example 2000 × 180, at least 500 pixels wide." },
  { name: "audience", label: "Who sees it", type: "select", options: ["ALL", "CLIENT", "STAFF"],
    optionLabels: { ALL: "Everyone", CLIENT: "Clients only", STAFF: "TOFAA team only" } },
  { name: "sortOrder", label: "Order (1 shows first)", type: "number" },
  { name: "isActive", label: "Active", type: "select", options: ["true", "false"] },
  { name: "startsOn", label: "Show from", type: "date", clearable: true },
  { name: "endsOn", label: "Show until", type: "date", clearable: true },
];

banners: {
  roles: ["SUPER_ADMIN"], title: "Banners", singular: "banner",
  emptyHint: "Upload a banner picture to show it on every dashboard.", modalWidth: "lg",
  description: "Pictures (any size with the 1000 × 90 shape) shown at the top of every dashboard. Add, reorder, schedule or switch them off.",
  endpoint: () => "/admin/banners",
  columns: ["imageUrl", "audience", "sortOrder", "isActive"],
  createFields: bannerFields, updateFields: bannerFields,
  updateEndpoint: (endpoint, record) => `${endpoint.split("?")[0]}/${record.id}`,
  deletePath: (endpoint, id) => `${endpoint.split("?")[0]}/${id}`,
},
```

The route is the generic `/banners` → `app/(portal)/[module]/page.tsx` → `ModuleGate` → `ModuleList`.

Banner-specific code inside `src/components/modules/module-list.tsx`:

1. **Field type `"image"`**: renders a file input (`accept="image/png,image/jpeg,image/webp"`) and, when editing, the current picture with the hint "Leave empty to keep the current picture."
2. **Client-side check before upload** (the API checks again):
   ```ts
   const BANNER_W = 1000, BANNER_H = 90, BANNER_MIN_W = 500;
   async function bannerImageError(file: File): Promise<string | null> {
     // type in png/jpeg/webp, size <= 5 MB, load into an <img> to read naturalWidth/Height,
     // ratio within 2% of 1000/90, width >= 500; otherwise return a readable message
   }
   ```
   On create, a missing picture gives "Choose a banner picture."
3. **Save**:
   ```ts
   if (moduleKey === "banners" && !editor) {
     // Create = upload the picture; the settings go in the query string as snake_case.
     const query = Object.fromEntries(Object.entries(body).map(([k, v]) =>
       [k.replace(/[A-Z]/g, (l) => `_${l.toLowerCase()}`), String(v)]));
     await sendImage("post", path, picture!, query);
   } else {
     if (moduleKey === "banners" && picture) await sendImage("put", `${path}/image`, picture);
     await mutateModule("patch", path, body);   // the settings
   }
   ```
4. **Table cell**: the `imageUrl` column shows a thumbnail `<img className="h-9 w-auto max-w-[22rem] rounded border" />`.

Navigation:
- `src/components/layout/sidebar.tsx`: `item("banners", "Banners", Megaphone)` in the "More" group (visibility comes from `moduleConfig.banners.roles`).
- `src/components/layout/topbar.tsx`: page title map `banners: "Banners"`.

#### b) Dashboard carousel

`src/features/dashboard/dashboard.service.ts`:

```ts
export type Banner = { id: string; imageUrl: string };
export const dashboardService = {
  banners: () => getModuleRecords("/banners", {}, { ttl: 60_000 }) as Promise<Banner[]>,
  // ...
};
```

`src/components/dashboard/insight-banner.tsx` (`"use client"`):
- Loads banners with `useAsync(() => dashboardService.banners(), "banners")`.
- Renders nothing when there are none.
- Shows one `<img src={banner.imageUrl} width={1000} height={90} className="block h-auto w-full" />` at a time, in a `rounded-xl overflow-hidden` section with `aria-roledescription="carousel"`.
- Moves on every **8 s** (`ROTATE_MS = 8000`) when there are 2 or more; pauses while the mouse is over it.
- Previous/next round buttons (`ChevronLeft`/`ChevronRight`) and an "n / total" counter with `aria-live="polite"`.

Used in `src/app/(portal)/home/page.tsx` as the first thing on the page: `<InsightBanner />`.

### 3.5 Banner flows

**Create:** Super admin opens `/banners` → "Add banner" → picks a picture + settings → frontend checks the shape →
`POST /admin/banners?audience=ALL&sort_order=1&is_active=true` with the raw file → API checks type, magic bytes, size and ratio →
stores the file at `images/banners/<hex>/<uuid>.png` → inserts the row (removes the file if the insert fails) → `201`.

**Edit:** PATCH the settings; if a new picture was chosen, `PUT /admin/banners/{id}/image` first (stores the new file, updates the row, removes the old file).

**Delete:** `DELETE /admin/banners/{id}` → delete the row → remove the file.

**View:** Home → `GET /banners` → the API returns active rows in the date window that match the user's audience, ordered by `sort_order`.

---

## 4. People module (recipients + groups)

### 4.1 What it does

"People" in the sidebar is one entry with two tabs: **Recipients** (`/recipients`) and **Groups** (`/recipient-groups`).

- A **recipient** is a person the tenant gifts to. Everything about them hangs off **one shared record** so the client's team and TOFAA's KAM edit the same data.
- Around that record: **preferences**, several **delivery addresses**, **relationships** to other recipients, **occasions** (events), **info-status** (follow-up on missing data), an **append-only change history**, and a computed **completeness score**.
- **Groups** are named sets of recipients used to gift many people at once.
- Features on the list: server-side paging/sorting, search, filters (relationship, city, group, upcoming occasion, status), multi-select with "select all matching", bulk archive/restore/delete, add-to-group, export (CSV/XLSX in the same columns as the import template), import from a spreadsheet, send gift.
- Adding a person uses a step-by-step panel with a duplicate check and a local draft.

### 4.2 Database

For a new project write one migration with the final shape (the current project reached it over several migrations).

`supabase/migrations/<ts>_recipients.sql`

```sql
-- 1. The recipient
create table if not exists public.recipients (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    name text,                                   -- required by the API on every write
    mobile_number text,
    email text check (email is null or (char_length(email) <= 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
    company text check (company is null or char_length(company) <= 200),
    designation text check (designation is null or char_length(designation) <= 120),
    city text check (city is null or char_length(city) <= 100),
    address jsonb,                               -- main address {address_line1, address_line2, city, state, postal_code, country}
    date_of_birth date,
    anniversary_date date,
    budget numeric(12,2) check (budget is null or budget >= 0),
    birthday_budget numeric(12,2) check (birthday_budget is null or birthday_budget >= 0),
    anniversary_budget numeric(12,2) check (anniversary_budget is null or anniversary_budget >= 0),
    gifting_occasion text check (gifting_occasion is null or length(trim(gifting_occasion)) between 1 and 200),
    remark text,
    avatar_url text,
    relationship text check (relationship is null or relationship in
        ('CLIENT','EMPLOYEE','PARTNER','ADVISOR','VENDOR','FAMILY','SPOUSE','CHILD','PARENT','SIBLING','FRIEND','OTHER')),
    recipient_type text not null default 'INTERNAL' check (recipient_type in ('EXTERNAL','INTERNAL')),
    status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
    is_primary boolean not null default false,
    version integer not null default 1,          -- optimistic locking
    source text not null default 'TOFAA' check (source in ('CLIENT','TOFAA','IMPORT')),
    import_batch_id uuid,                        -- references public.import_batches(id) on delete set null (if you build imports history)
    created_by_user_id uuid references public.profiles(id) on delete set null,
    updated_by_user_id uuid references public.profiles(id) on delete set null,
    deleted_at timestamptz,                      -- soft delete
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, id),                      -- lets child tables use composite (tenant_id, recipient_id) FKs
    constraint recipients_address_shape_check check (
        address is null or coalesce(
            jsonb_typeof(address) = 'object'
            and length(btrim(address->>'address_line1')) > 0
            and length(btrim(address->>'city')) > 0
            and (address->>'postal_code') ~ '^[0-9]{6}$'
            and (address->>'country') ~ '^[A-Z]{2}$', false))
);
create unique index recipients_tenant_mobile_number_active_uq on public.recipients (tenant_id, mobile_number) where deleted_at is null;
create index recipients_tenant_created_idx on public.recipients (tenant_id, created_at desc) where deleted_at is null;
create index recipients_tenant_status_idx  on public.recipients (tenant_id, status) where deleted_at is null;
create index recipients_tenant_city_idx    on public.recipients (tenant_id, lower(city)) where city is not null and deleted_at is null;
create index recipients_tenant_email_idx   on public.recipients (tenant_id, lower(email)) where email is not null and deleted_at is null;
create trigger recipients_updated_at before update on public.recipients for each row execute function public.handle_updated_at();

-- 2. Links between recipients (one row per direction)
create table public.recipient_relationships (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    recipient_id uuid not null,
    related_recipient_id uuid not null,
    relationship_type text not null check (relationship_type in
        ('SPOUSE','SON','DAUGHTER','PARENT','SIBLING','BUSINESS_ASSOCIATE','COLLEAGUE','OTHER')),
    created_by_user_id uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    check (recipient_id <> related_recipient_id),
    foreign key (tenant_id, recipient_id) references public.recipients (tenant_id, id) on delete cascade,
    foreign key (tenant_id, related_recipient_id) references public.recipients (tenant_id, id) on delete cascade,
    unique (tenant_id, recipient_id, related_recipient_id)
);

-- 3. People who share an event (e.g. both partners on an anniversary). Needs public.events.
create table public.event_participants (
    event_id uuid not null references public.events(id) on delete cascade,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    recipient_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (event_id, recipient_id),
    foreign key (tenant_id, recipient_id) references public.recipients (tenant_id, id) on delete cascade
);

-- 4. Gifting preferences (one row per recipient)
create table public.recipient_preferences (
    recipient_id uuid primary key,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    interests text[] not null default '{}',
    preferred_brands text[] not null default '{}',
    gift_preferences text check (gift_preferences is null or char_length(gift_preferences) <= 2000),
    dietary_preferences text check (dietary_preferences is null or char_length(dietary_preferences) <= 1000),
    gifts_to_avoid text check (gifts_to_avoid is null or char_length(gifts_to_avoid) <= 1000),
    special_instructions text check (special_instructions is null or char_length(special_instructions) <= 2000),
    updated_by_user_id uuid references public.profiles(id) on delete set null,
    updated_at timestamptz not null default now(),
    foreign key (tenant_id, recipient_id) references public.recipients (tenant_id, id) on delete cascade
);

-- 5. Delivery addresses (many per person, one default)
create table public.recipient_addresses (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    recipient_id uuid not null,
    label text not null check (label in ('PERMANENT','CURRENT','OFFICE')),
    address_line1 text not null check (char_length(address_line1) between 3 and 300),
    address_line2 text check (address_line2 is null or char_length(address_line2) <= 300),
    city text not null check (char_length(city) between 1 and 100),
    state text check (state is null or char_length(state) <= 100),
    postal_code text not null check (postal_code ~ '^[0-9]{6}$'),
    country text not null default 'IN' check (country ~ '^[A-Z]{2}$'),
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (tenant_id, recipient_id) references public.recipients (tenant_id, id) on delete cascade
);
create unique index recipient_addresses_one_default_uq on public.recipient_addresses (recipient_id) where is_default;

-- 6. Follow-up state of each missing piece of information
create table public.recipient_info_status (
    recipient_id uuid not null,
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    field_key text not null check (char_length(field_key) between 1 and 60),
    status text not null check (status in
        ('PENDING','REQUESTED_FROM_CLIENT','KAM_FOLLOW_UP','SUBMITTED_FOR_CONFIRMATION','VERIFIED','NOT_APPLICABLE')),
    note text check (note is null or char_length(note) <= 1000),
    updated_by_user_id uuid references public.profiles(id) on delete set null,
    updated_at timestamptz not null default now(),
    primary key (recipient_id, field_key),
    foreign key (tenant_id, recipient_id) references public.recipients (tenant_id, id) on delete cascade
);

-- 7. Append-only history
create table public.recipient_audit (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    recipient_id uuid not null,
    actor_user_id uuid not null,
    actor_name text,
    actor_role text not null,
    action text not null check (action in ('CREATE','EDIT','IMPORT','UPDATE','ARCHIVE','RESTORE','DELETE')),
    field text, old_value jsonb, new_value jsonb,
    source text not null default 'MANUAL'
        check (source in ('MANUAL','EXCEL_IMPORT','CALL','WHATSAPP','MEETING','EMAIL','OTHER'))
);
create index recipient_audit_recipient_idx on public.recipient_audit (tenant_id, recipient_id, created_at desc);
-- + a BEFORE UPDATE OR DELETE trigger that raises 'recipient_audit_is_append_only'

-- 8. Groups
create table public.spend_recipient_groups (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete restrict,
    name text not null check (length(trim(name)) between 1 and 120),
    created_by_user_id uuid not null references public.profiles(id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (tenant_id, id)
);
create unique index spend_recipient_groups_tenant_name_uq on public.spend_recipient_groups(tenant_id, lower(name));
create table public.spend_recipient_group_members (
    tenant_id uuid not null,
    group_id uuid not null,
    recipient_id uuid not null,
    created_at timestamptz not null default now(),
    primary key (tenant_id, group_id, recipient_id),
    foreign key (tenant_id, group_id) references public.spend_recipient_groups(tenant_id, id) on delete cascade,
    foreign key (tenant_id, recipient_id) references public.recipients(tenant_id, id) on delete restrict
);

-- Save a group and replace its members in one transaction
create or replace function public.save_spend_recipient_group(
    p_tenant_id uuid, p_group_id uuid, p_name text, p_recipient_ids uuid[], p_actor_id uuid
) returns public.spend_recipient_groups language plpgsql security definer set search_path = '' as $$
declare v_group public.spend_recipient_groups%rowtype; v_count integer;
begin
    if nullif(trim(p_name), '') is null or coalesce(cardinality(p_recipient_ids), 0) = 0 then
        raise exception 'invalid_spend_group' using errcode = 'P0001'; end if;
    select count(distinct x) into v_count from unnest(p_recipient_ids) x;
    if v_count <> cardinality(p_recipient_ids) then raise exception 'duplicate_group_recipient' using errcode = 'P0001'; end if;
    if exists (select 1 from unnest(p_recipient_ids) x left join public.recipients r
        on r.tenant_id = p_tenant_id and r.id = x and r.deleted_at is null where r.id is null) then
        raise exception 'recipient_not_in_tenant' using errcode = 'P0001'; end if;
    if p_group_id is null then
        insert into public.spend_recipient_groups(tenant_id, name, created_by_user_id)
        values (p_tenant_id, trim(p_name), p_actor_id) returning * into v_group;
    else
        update public.spend_recipient_groups set name = trim(p_name), updated_at = now()
        where tenant_id = p_tenant_id and id = p_group_id returning * into v_group;
        if not found then raise exception 'spend_group_not_found' using errcode = 'P0001'; end if;
        delete from public.spend_recipient_group_members where tenant_id = p_tenant_id and group_id = p_group_id;
    end if;
    insert into public.spend_recipient_group_members(tenant_id, group_id, recipient_id)
    select p_tenant_id, v_group.id, x from unnest(p_recipient_ids) x;
    return v_group;
end; $$;

-- Lock everything down: only the API (service role) reads and writes.
alter table public.recipients enable row level security;
alter table public.recipient_relationships enable row level security;
alter table public.event_participants enable row level security;
alter table public.recipient_preferences enable row level security;
alter table public.recipient_addresses enable row level security;
alter table public.recipient_info_status enable row level security;
alter table public.recipient_audit enable row level security;
alter table public.spend_recipient_groups enable row level security;
alter table public.spend_recipient_group_members enable row level security;
-- revoke all ... from public, anon, authenticated; grant select, insert, update, delete ... to service_role;
-- recipient_audit: grant select, insert only. Revoke execute on the RPC from public/anon/authenticated.
notify pgrst, 'reload schema';
```

### 4.3 Backend — `backend/src/modules/recipients/`

```
recipients/
├── __init__.py
├── schemas.py         request/response models
├── service.py         RecipientService: list, summary, duplicates, create, get, update, delete, bulk, restore, avatar
├── profile.py         second router + ProfileService: preferences, addresses, relationships, participants, info-status, activity
├── trail.py           change history: SOURCES, diff(), record(), record_many(), list_trail()
└── completeness.py    profile completeness score
```

Groups live in `backend/src/modules/gift_spend/` (router prefix `/tenants/{tenant_id}/gift-spend`). In a new project
you can put them in their own `recipient_groups/` module, but **keep the same URLs** so the frontend flow stays the same.

Occasions use the events module: `POST /tenants/{tenant_id}/recipients/{recipient_id}/events`,
`GET  /tenants/{tenant_id}/recipients/{recipient_id}/events`, `PATCH/DELETE /tenants/{tenant_id}/events/{event_id}`.

#### schemas.py

```python
Relationship = Literal["CLIENT","EMPLOYEE","PARTNER","ADVISOR","VENDOR","FAMILY","SPOUSE","CHILD","PARENT","SIBLING","FRIEND","OTHER"]
RecipientStatus = Literal["ACTIVE", "ARCHIVED"]
RecipientType = Literal["EXTERNAL", "INTERNAL"]
EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
# every model: ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True)

class RecipientAddress:  address_line1 (3–300), address_line2?, city (1–100), state?, postal_code r"^[0-9]{6}$", country "IN" (2 upper letters)

class RecipientCreate:
    name (1–200, required); mobile_number? r"^\+?[1-9][0-9]{7,14}$"; address?: RecipientAddress
    date_of_birth? (not in the future); anniversary_date?; email?; company? (≤200); city? (≤100)
    recipient_type = "INTERNAL"; allow_duplicate = False
    budget?, birthday_budget?, anniversary_budget?  (Decimal ≥0, 12 digits, 2 decimals)
    remark? (≤2000); relationship?; designation? (≤120); is_primary = False; gifting_occasion? (1–200)

class RecipientUpdate:  same fields all optional + status? + version? (≥1)
    validator: at least one field besides version; name/address/date_of_birth/budget/status/is_primary/recipient_type/version may not be null

class NextOccasion:  kind "BIRTHDAY"|"ANNIVERSARY", label, date, days_away
class GroupRef:      id, name
class RecipientRead: every column above + avatar_url, status, version, next_occasion?, completeness? (dict), groups: list[GroupRef]
class BulkRecipientIds:    recipient_ids: list[UUID] (1–1000)
class BulkRecipientStatus: BulkRecipientIds + status
class BulkResult:          affected: int
class RecipientSummary:    total, active, archived, cities: list[str], relationships: list[str]
class RecipientList:       items, pagination, next_cursor
```

#### Endpoints — recipients (`router.py`, mounted with the tenant guard)

| Method | Path | Body / query | Result |
|---|---|---|---|
| GET | `/tenants/{t}/recipients` | `page, limit(≤100), recipientIds (csv ≤100), search, relationship, city, groupId, status, upcomingDays(1–366), sort (name\|city\|mobile\|created\|nextOccasion), order (asc\|desc)` | `RecipientList` (default sort `created` desc; other sorts asc) |
| GET | `/tenants/{t}/recipients/duplicates` | `name, mobileNumber, email` | `[{id, name, mobileNumber, email, city, status, reasons: [SAME_MOBILE\|SAME_EMAIL\|SAME_NAME]}]` |
| GET | `/tenants/{t}/recipients/summary` | – | `RecipientSummary` (cached; cleared on writes) |
| POST | `/tenants/{t}/recipients` | `RecipientCreate`; headers `X-Change-Source`, `X-Import-Batch` | `201`. **409** with `data.duplicates` if the person may already exist (resend with `allowDuplicate: true`). **409** for a duplicate mobile number. |
| POST | `/tenants/{t}/recipients/bulk-delete` | `{recipientIds}` | `{affected}` |
| POST | `/tenants/{t}/recipients/bulk-status` | `{recipientIds, status}` | `{affected}` |
| GET | `/tenants/{t}/recipients/{id}` | – | `RecipientRead` with groups + completeness |
| PATCH | `/tenants/{t}/recipients/{id}` | `RecipientUpdate` incl. `version` | **409** `{current, reason: "VERSION_CONFLICT"}` if someone saved first |
| PUT | `/tenants/{t}/recipients/{id}/avatar` | raw image (≤2 MB) | `RecipientRead` |
| DELETE | `/tenants/{t}/recipients/{id}/avatar` | – | `RecipientRead` |
| DELETE | `/tenants/{t}/recipients/{id}` | – | soft delete (sets `deleted_at`) |
| POST | `/tenants/{t}/recipients/{id}/restore` | – | undoes the soft delete |

> Route order matters: declare `/duplicates`, `/summary`, `/bulk-delete`, `/bulk-status` **before** `/{recipient_id}`.

#### Endpoints — profile (`profile.py`, second router, also tenant-guarded)

Base: `/tenants/{t}/recipients/{id}`

| Method | Path | Body |
|---|---|---|
| GET / PUT | `/preferences` | `{interests[], preferredBrands[], giftPreferences, dietaryPreferences, giftsToAvoid, specialInstructions}` (lists ≤30 items, each 1–60 chars) |
| GET / POST | `/addresses` | `{label: PERMANENT\|CURRENT\|OFFICE, addressLine1, addressLine2, city, state, postalCode, country, isDefault}` |
| PATCH / DELETE | `/addresses/{address_id}` | partial address |
| GET / PUT | `/relationships` | `{items: [{relatedRecipientId, relationshipType}]}` (replaces the whole list) |
| PUT | `/tenants/{t}/events/{event_id}/participants` | `{recipientIds}` |
| GET / PUT | `/info-status` | `{fieldKey: contact\|city\|company\|designation\|relationship\|birthday\|preferences\|address, status, note}` |
| GET | `/activity?page&limit` | change history (`trail.list_trail`) |

Every `ProfileService` call first proves the recipient belongs to the tenant, and every write records a `trail` entry.

#### Endpoints — groups (`gift_spend/router.py`, prefix `/tenants/{t}/gift-spend`)

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/groups` | – | `[{id, tenantId, name, recipientIds[], createdAt, updatedAt}]` ordered by name |
| POST | `/groups` | `{name (1–100), recipientIds (1–1000, unique)}` | calls RPC `save_spend_recipient_group` with `p_group_id = null` |
| PUT | `/groups/{group_id}` | same | replaces name **and** the whole member list |
| DELETE | `/groups/{group_id}` | – | FK error `23503` → "group is used by an occasion" |
| POST | `/groups/bulk-delete` | `{groupIds (≤200)}` | `{deleted, blocked: [names]}` |

Permissions: `GIFT_SPEND_READ` to list, `GIFT_SPEND_MANAGE` to change.

#### service.py — rules to copy exactly

1. **Every method** starts with `require_permission(actor, Permission.RECIPIENT_*)` and `_require_tenant_access(tenant_id, actor)`
   (wraps `tenant_service.require_access`; turns a denial into **404 "Recipient not found."** so other tenants' IDs are not revealed).
2. **List**:
   - empty `recipientIds` → empty page; `groupId` → load member IDs from `spend_recipient_group_members`.
   - Fast path (database does paging): `.eq(tenant).is_(deleted_at null)` + filters + `.order(column).order("id").range(offset, offset+limit-1)`, `count="exact"`.
   - In-memory path (only when `upcomingDays` is set, `sort=nextOccasion`, or a group has > 150 members): load up to 5000 rows, filter/sort in Python, slice.
   - Search: strip `, ( ) % * \ :` from the term, then `or_("name.ilike.%t%,mobile_number.ilike.%t%,email.ilike.%t%,city.ilike.%t%")`.
   - `next_occasion`: the soonest coming birthday/anniversary from the saved month/day (29 Feb → 28 Feb in common years).
   - `_enrich(page)`: for the whole page at once (never one query per person), run **in parallel** the group lookup and counts from
     `recipient_relationships`, active `events`, `recipient_addresses`, `recipient_preferences`, and `recipient_info_status` (NOT_APPLICABLE). Then set `item.groups` and `item.completeness`. A failed lookup only leaves that decoration off; the list still loads.
3. **Create**: unless `allow_duplicate`, run `_find_duplicates` (same mobile, same email, name ilike when ≥3 chars) → `ApiError(409, "This person may already be in your recipients.", {"duplicates": matches})`.
   Copy `address.city` into `city` when city is empty. Set `tenant_id`, `source` (`CLIENT` if the actor is a client else `TOFAA`), `created_by/updated_by`, optional `import_batch_id`.
   Map a unique-index error to 409 "A recipient with this mobile number already exists." Record a trail entry (`CREATE`, or `IMPORT` when source is `EXCEL_IMPORT`).
4. **Update** (optimistic locking): if `payload.version` differs from the row's version → 409 with the latest copy.
   Write with `.eq("version", payload.version)` so a save in between matches nothing → 409 again. Increment `version`.
   Diff old vs new with `trail.diff`; action is `ARCHIVE` / `RESTORE` when `status` changed, otherwise `EDIT`.
5. **Delete** is soft (`deleted_at = now()`). **Bulk** operations run in chunks of 150 IDs, count only rows really changed, and call `trail.record_many`.
6. **Avatar**: `images.store_image(db, f"recipients/{tenant_id}/{recipient_id}", ...)` (2 MB default). On failure remove the new file; on success remove the old one.

#### trail.py

```python
SOURCES = {"MANUAL","EXCEL_IMPORT","CALL","WHATSAPP","MEETING","EMAIL","OTHER"}
SOURCE_HEADER = "X-Change-Source"
TRACKED = (...the recipient fields whose changes are recorded...)
def source_of(value) -> str            # unknown/missing -> "MANUAL"
def diff(old, new) -> [(field, old, new)]
def record(db, tenant_id, recipient_id, actor, action, changes=None, source="MANUAL")  # one row per changed field
def record_many(db, tenant_id, ids, actor, action, source="MANUAL")
def list_trail(db, tenant_id, recipient_id, page, limit) -> TrailList
```

#### completeness.py

Sections and weights: `basic 30` (name, contact = mobile or email, city, + company for EXTERNAL), `relationships 15`,
`occasions 20` (birthday or any active event), `preferences 15`, `addresses 20`. Fields marked `NOT_APPLICABLE` in
`recipient_info_status` are left out. Returns `{percent, sections: [{key, label, percent, missing[], applicable}], needsAttention: percent < 50}`.

#### Mounting

```python
from src.modules.recipients.router import router as recipients_router
from src.modules.recipients.profile import router as recipient_profile_router
from src.modules.gift_spend.router import router as gift_spend_router
tenant_scoped = [Depends(enforce_tenant_scope)]
api_router.include_router(recipients_router, dependencies=tenant_scoped)
api_router.include_router(recipient_profile_router, dependencies=tenant_scoped)
api_router.include_router(gift_spend_router, dependencies=tenant_scoped)
```

#### Tests — `backend/tests/unit/recipients/`

`test_recipient_schemas.py` (validation), `test_bulk_schemas.py`, `test_recipient_service_scope.py` (other tenant → 404, missing permission → 403),
`test_recipient_directory.py` (next occasion, filters, sorting), `test_recipient_onboarding.py` (duplicates 409, version conflict 409, completeness).

### 4.4 Frontend

#### Files

```
src/app/(portal)/recipients/page.tsx          <Suspense><RecipientsGate /></Suspense>
src/app/(portal)/recipients/new/page.tsx      <RecipientWizardGate />   (full-page add, optional)
src/app/(portal)/recipient-groups/page.tsx    <RecipientGroupsGate />

src/components/modules/people-tabs.tsx        "Recipients" / "Groups" tabs (TabBar, solid variant, with counts)
src/components/modules/recipient-multi-select.tsx   picker used by the generic group form

src/components/recipients/
├── recipients-gate.tsx          role check from moduleConfig.recipients.roles → <RecipientsView />
├── recipients-view.tsx          the list page (state, filters, selection, bulk actions, dialogs)
├── recipients-table.tsx         table: checkbox, name/avatar/groups, relationship pill, mobile, city, next occasion, completeness, row actions
├── recipient-utils.tsx          DirectoryRow/Summary types, RELATIONSHIPS (label + pill colour), UPCOMING_OPTIONS, date/mobile formatters
├── recipient-dialog.tsx         profile view: photo upload, details, recent activity (`/{id}/activity`)
├── recipient-fields.tsx         shared form fields
├── group-sheet.tsx              create / rename / delete a group (modal)
├── groups-panel.tsx             Groups tab: list groups, open one, search members, remove members, bulk delete
├── recipient-groups-gate.tsx    role check → <GroupsPanel />
├── import-recipients-sheet.tsx  spreadsheet import
├── add-recipients-sheet.tsx
├── send-gift-dialog.tsx         client sends a gift to the person(s)
└── wizard/
    ├── recipient-create-panel.tsx   the Add/Edit panel (Sheet) with steps
    ├── wizard-types.ts              data shape, steps, validation, local draft
    ├── wizard-save.ts               findDuplicates() + saveWizard()
    ├── edit-profile.ts              loadEditData() + saveEditParts() for edit mode
    ├── steps-basic.tsx              Details step
    ├── steps-more.tsx               Occasions + Preferences steps
    ├── address-step.tsx             delivery addresses
    ├── step-review.tsx              review before save
    ├── person-picker.tsx            choose a linked recipient
    ├── wizard-stepper.tsx  wizard-preview.tsx  step-details-page.tsx
    └── recipient-wizard-page.tsx / recipient-wizard-gate.tsx   (full-page version)

src/lib/recipient-fields.ts      import/export columns, header aliases, autoMap(), buildRecipient(), recipientToCells(), templateRows()
```

#### module-config entries

```ts
recipients: { roles: ALL_ROLES, title: "People", singular: "recipient", modalWidth: "xl",
  emptyHint: "Add the people you gift and we'll remind you before every important date.",
  description: "Everyone you send gifts to, in one place.",
  endpoint: (u, tenant) => `/tenants/${requireTenant(u, tenant)}/recipients`,
  columns: ["name", "mobileNumber", "dateOfBirth", "budget"],
  deletePath: (endpoint, id) => `${endpoint}/${id}` /* + updateFields */ },

"recipient-groups": { roles: ALL_ROLES, title: "Groups", singular: "group", modalWidth: "sm",
  emptyHint: "Groups let you gift many people at once.",
  description: "Put people into groups so you can plan and gift together.",
  endpoint: (u, tenant) => `/tenants/${requireTenant(u, tenant)}/gift-spend/groups`,
  columns: ["name", "recipientIds"],
  createFields: [{ name: "name", label: "Group name", required: true },
                 { name: "recipientIds", label: "Recipient", type: "recipient-multi-select", required: true }],
  updateFields: /* same */, updateMethod: "put", deletePath: (endpoint, id) => `${endpoint}/${id}` },
```

Sidebar: `item("recipients", "People", Users, ["/recipient-groups"])` (the 4th argument keeps "People" highlighted on the Groups tab).

#### recipients-view.tsx — how the list works

1. **Endpoints**: `recipients = moduleConfig.recipients.endpoint(user, selectedTenantId)`, `groups = moduleConfig["recipient-groups"].endpoint(...)`. If `requireTenant` throws, show its message in an amber box.
2. **State**: `rows, total, summary, groups, search, query (debounced 400 ms), filters {relationship, city, groupId, upcoming, status}, sort {key, descending}, page, pageSize (10/20/30/40/50/100, saved in localStorage "tofaa-recipients-page-size"), selected: Set<string>`.
3. **loadPage()** → `getModuleRecords(recipients, { page, limit, search, relationship, city, groupId, status, upcomingDays, sort, order })`.
   A counter (`latestLoad`) makes sure only the newest response is applied.
4. **loadSide()** → in parallel `GET {recipients}/summary` (counts + filter choices) and `loadAllModuleRecords(groups)`.
5. When the tenant changes, clear rows, summary, groups, selection and filters.
6. **URL hooks**: `?new=1` opens the Add panel; `?open=<id>` opens that person's profile, then `router.replace("/recipients")`.
7. **Top row**: `<PeopleTabs>` + Relationship filter + City filter (searchable) + Import + Export (all) + "Add Recipient".
   **Second row**: Group filter, Upcoming occasion (7/30/90 days), Status (Active/Archived), search box, "Clear all".
8. **Selection bar** (when something is ticked): "Select all N recipients" (loads every matching row via `loadAllModuleRecords(recipients?filters)`), Add to Group (existing group → `PUT groups/{id}` with merged IDs, or "New group…"), Export selected, Send Gift (exactly one), Archive/Restore, Delete, Clear.
   `fetchSelected()` gets rows for ticked IDs on other pages with `recipientIds=` in batches of 100.
9. **Bulk** calls go in chunks of 1000 to `POST {recipients}/bulk-delete` or `/bulk-status`.
10. **Send gift**: a client opens `SendGiftDialog`; staff go to `/requests?new=1&recipientId=<id>`.
11. Dialogs at the bottom: two `RecipientCreatePanel`s (add and edit), `RecipientDialog` (profile), `GroupSheet`, `SendGiftDialog`, `ImportRecipientsSheet`, `DeleteDialog`.
12. Pagination footer: "Showing a – b of N recipients", rows-per-page select, page buttons with ellipses.

#### Add / Edit recipient flow (wizard)

Steps in the panel: **Recipient Details → Occasions → Preferences & Delivery → Review & Save**.

`wizard-types.ts`:
- `WizardData = { details, relationship, occasions[], preferences, addresses[], allowDuplicate, sameAddress }`.
- `normaliseMobile("98765 43210") → "+919876543210"`; `MOBILE_OK = /^\+?[1-9][0-9]{7,14}$/`.
- `validateDetails` (name and mobile required), `validateOccasion` (one birthday only, no duplicate occasion on the same date), `validateAddress` (line1 ≥ 3, city, 6-digit PIN).
- **Draft**: saved in localStorage under `tofaa-recipient-draft:<userId>:<tenantId>` with the step number; offered again when the panel reopens; cleared after a save.

`wizard-save.ts`:

```text
1. findDuplicates()  -> GET {recipients}/duplicates?name&mobileNumber&email
   If matches: show them; the user picks "this is a different person" -> allowDuplicate = true.
2. POST {recipients}  (header X-Change-Source: MANUAL)
   body: name, recipientType, allowDuplicate, isPrimary, mobileNumber, email, company, designation, city,
         relationship, dateOfBirth (a past Birthday occasion), anniversaryDate (an Anniversary without participants),
         address (the default delivery address)
   409 with data.duplicates -> throw DuplicateFound(matches)
3. Then each optional part on its own; a failure becomes a warning, never loses the person:
   - photo          PUT  {recipients}/{id}/avatar (raw file)
   - addresses      POST {recipients}/{id}/addresses  (default first)
   - preferences    PUT  {recipients}/{id}/preferences
   - relationships  PUT  {recipients}/{id}/relationships
   - other occasions POST {recipients}/{id}/events, then PUT /tenants/{t}/events/{eventId}/participants if shared
   - groups         PUT  {groups}/{groupId} with the merged recipientIds; or POST {groups} for a new group
4. GET {recipients}/{id} for the success screen (completeness score), return { recipientId, name, profile, warnings }.
```

Edit mode (`edit-profile.ts`): `loadEditData` loads the person, preferences, addresses, relationships and events in parallel into the same `WizardData`.
`saveEditParts` saves only what changed: `PATCH` the recipient (with `version`), and for addresses/occasions it deletes removed ones, patches changed ones and posts new ones.

#### Groups tab (`groups-panel.tsx`)

- Loads `{recipients}/summary` and all groups. Opening a group fetches its people by `recipientIds` in small batches.
- Remove a person → `PUT {groups}/{id}` with the remaining IDs. Bulk delete → `POST {groups}/bulk-delete` in chunks of 200; show the `blocked` names.
- `group-sheet.tsx`: create (`POST {groups}`) / rename + change members (`PUT {groups}/{id}`) / delete (`DELETE {groups}/{id}`).

#### Import (`import-recipients-sheet.tsx` + `lib/recipient-fields.ts`)

1. Download a template (same columns as export): Name*, Mobile Number*, Address, Gifting Occasion, Date of Birth, Date of Anniversary, Birthday Budget, Anniversary Budget, City, Pincode, Group.
2. Read the file with `readTable`; `autoMap` matches headers using the alias lists; the user can fix the mapping.
3. `buildRecipient(row)` makes a create body and lists problems per row; invalid rows are shown and skipped.
4. Optionally `POST /tenants/{t}/import-batches` → `batchId`.
5. For each valid row: `POST {recipients}` with headers `X-Change-Source: EXCEL_IMPORT` and `X-Import-Batch: <batchId>`. A dropped connection or 5xx is retried; before retrying it searches by mobile number in case the first try saved.
6. Group column: add the created IDs to an existing group (`PUT`) or create it (`POST`).
7. `PATCH /import-batches/{batchId}` with created/failed counts; then refresh the list.

Export uses `writeTable(FIELD_HEADERS, people.map(recipientToCells), format, "recipients")`, so an exported file can be edited and imported again.

---

## 5. Build order checklist for the new project

**Banners**
1. Migration `dashboard_banners` (section 3.2). Make sure the `images` bucket exists.
2. `core/images.py` with `aspect_ratio` + `min_width` support.
3. `modules/banners/{schemas,service,router}.py`; mount outside the tenant guard; add unit tests.
4. `module-config.ts` → `banners` entry + `bannerFields`; `module-list.tsx` → `image` field type, `bannerImageError`, raw upload on create, `/image` PUT on edit, thumbnail cell.
5. Sidebar item + topbar title.
6. `dashboard.service.ts` → `banners()`; `components/dashboard/insight-banner.tsx`; render `<InsightBanner />` at the top of Home.

**People**
1. Migrations: recipients and its child tables, groups + `save_spend_recipient_group` RPC (section 4.2). Events table must exist for occasions/participants.
2. RBAC permissions `RECIPIENT_*`, `GIFT_SPEND_READ/MANAGE`.
3. `modules/recipients/{schemas,trail,completeness,service,router,profile}.py`; groups router/service; mount with `enforce_tenant_scope`; tests.
4. `module-config.ts` → `recipients` and `recipient-groups` entries; sidebar "People" item.
5. Pages `/recipients`, `/recipient-groups` (and optionally `/recipients/new`).
6. Components in this order: `recipient-utils` → `people-tabs` → `recipients-table` → `recipients-view` → `group-sheet` / `groups-panel` → wizard (`wizard-types` → `wizard-save` → steps → `recipient-create-panel` → `edit-profile`) → `recipient-dialog` → `lib/recipient-fields` + `import-recipients-sheet` → `send-gift-dialog`.
7. Regenerate `backend/API_REFERENCE.md`.

**Check when done**
- A client cannot read another tenant's recipient (404).
- Two people editing the same recipient: the second save gets 409 with the latest copy.
- Adding a person with an existing mobile number gives the duplicate prompt; "different person" saves it.
- A banner with the wrong shape is refused by both the form and the API; a non-active or out-of-date banner does not appear on Home; `CLIENT`-only banners are not shown to staff.
