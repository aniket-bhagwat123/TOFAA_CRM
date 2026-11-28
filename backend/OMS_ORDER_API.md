# TOFAA CRM: Handover API for the OMS (v1)

The CRM exposes the API. The OMS **reads approved handovers** and **sends status back**. The OMS receives a handover,
not an order: it creates its own order after Finance confirms the advance. The CRM never sends selling price, margin,
GST, transport charges, billing name, GSTIN or internal notes.

> This replaces the earlier `/api/v1/oms/orders` API, which no longer exists.

## 1. Connection

| | |
|---|---|
| Base URL | `https://<crm-api-host>/api/v1/handovers` (test and live addresses to be confirmed) |
| Authentication | Header `X-API-Key: <key>` on every call. Test and live use different keys, shared privately. |
| Transport | HTTPS only |
| Format | JSON, `snake_case`. Dates `YYYY-MM-DD`. Times UTC ISO 8601. Quantities are whole numbers. |
| Answers | `{ "data": ..., "message": "..." }`, errors included |
| Swagger | `https://<crm-api-host>/api/v1/docs`, tag **OMS handovers** (off in production). File: `oms-handover.openapi.json` |

## Names and numbers

| Record | Number | Made by |
|---|---|---|
| Deal | `DEAL-YYYY-####` | CRM |
| Handover | `HO-YYYY-####`, at first submit; the same across versions | CRM |
| Order | `TOF-ORD-YYYY-#####` (`oms_order_number`) | OMS |

The CRM has Deals, not Orders. **When the OMS first sends a status with its `oms_order_number` (any stage except
`cancelled`), the deal is marked Won**, valued at the agreement total.

## 2. Flow

```
CRM                                                   OMS
Agreement signed
KAM prepares the handover        (draft)
KAM sends it for approval        (pending_approval)
Sales Manager approves           (approved, v1)  ---> reads it (GET)
                                                      Ops confirms the date, Finance confirms the advance
                                 CRM order status <-- POST status: accepted ... delivered
KAM edits it                     (draft)              still reads v1
Sales Manager approves again     (approved, v2)  ---> reads v2, shows what changed
KAM cancels                      (cancelled, v3) ---> reads status "cancelled"; Super Admin decides
                                                 <--- POST status: cancelled
```

Rejected by the Sales Manager (`rejected`): the KAM corrects it and sends it again. The OMS sees nothing of this.
Older records made by hand never go to the OMS; new ones can no longer be made.

## 3. Read handovers

### `GET /handovers`

| Parameter | Meaning |
|---|---|
| `status` | `approved` or `cancelled`. **Leave out when polling**, otherwise cancellations are missed. |
| `updated_since` | Changed at or after this UTC time, e.g. `2027-01-01T00:00:00Z` |
| `page`, `limit` | Default 1 and 25; `limit` at most 100. Oldest change first. |

`data` is `{ "items": [Handover], "page": 1, "limit": 25, "total": 3 }`.

Poll every 5 minutes (plus a manual "Fetch now") with `updated_since` set to the latest `updated_at` seen. Read all
pages. A handover may be repeated: use `handover_number` + `version` to ignore what you already have.

### `GET /handovers/{handover_number}`

The last approved version. While an edit waits for approval, the earlier version is returned.

```json
{
  "handover_number": "HO-2027-0001", "deal_number": "DEAL-2027-0001", "deal_id": "uuid", "version": 1, "status": "approved",
  "updated_at": "2027-01-05T10:30:00Z",
  "client": { "client_id": "uuid", "company_name": "Client Pvt Ltd", "client_type": "Key Account" },
  "sales_owner": { "name": "KAM name", "email": "kam@example.com" },
  "campaign_name": "Diwali 2027",
  "total_kits": 100, "delivery_deadline": "2027-01-31", "advance_percent": 50,
  "design_brief": { "text": "…", "reference_file_urls": ["https://…"], "logo_file_urls": ["https://…"] },
  "sample": { "required": true,
              "approval": { "approver_name": "…", "approved_on": "2027-01-03", "evidence_url": "https://…" } },
  "items": [
    { "item_ref": "IT-1a2b3c4d5e", "product_id": null, "name": "Mug", "description": "Ceramic",
      "quantity_per_kit": 1, "is_packaging": false, "photo_urls": ["https://…"] }
  ],
  "delivery_locations": [
    { "location_ref": "LOC-1a2b3c4d5e",
      "address": { "line": "…", "city": "Pune", "state": "Maharashtra", "pincode": "411001" },
      "contact_name": "…", "contact_phone": "…", "quantity": 100 }
  ],
  "client_instructions": "…"
}
```

| Field | Notes |
|---|---|
| `handover_number` | Unique, never reused. Use it to stop duplicates. |
| `version` | +1 on every approved edit and on cancel |
| `client.client_type`, `campaign_name`, `design_brief.text`, `client_instructions`, `advance_percent` | May be `null` |
| `items[].product_id` | `null` for custom items; OMS Procurement links it |
| `items[].item_ref`, `delivery_locations[].location_ref` | Stay the same across versions |
| `delivery_locations[].quantity` | May be `null`. When every location has one, they add up to `total_kits` |
| `sample.approval` | `null` until the client approved the sample |
| `delivery_deadline` | The date asked for. Ops confirms it in the OMS and can send it back (`confirmed_delivery_deadline`) |
| File links | Signed, valid for at least 10 minutes. Download the files; read the handover again for new links. |

**One kit type per handover:** `total_kits` and `quantity_per_kit` describe one kind of kit.

## 4. Send status

### `POST /handovers/{handover_number}/status`

```json
{
  "oms_order_id": "6f1c2a", "oms_order_number": "TOF-ORD-2027-00001",
  "stage": "dispatched", "changed_at": "2027-01-20T09:15:00Z", "note": "First lot",
  "confirmed_delivery_deadline": "2027-01-31",
  "locations": [
    { "location_ref": "LOC-1a2b3c4d5e", "kits": 60, "transporter": "BlueDart", "tracking_number": "BD123",
      "dispatched_at": "2027-01-20T09:00:00Z" }
  ]
}
```

| Field | Required |
|---|---|
| `oms_order_id`, `oms_order_number` (`TOF-ORD-YYYY-NNNNN`), `stage`, `changed_at` (with time zone) | Always |
| `note` | For `on_hold` and `cancelled` |
| `locations[]` with `location_ref` | For `dispatched` and `delivered` |
| `locations[].kits` | For `dispatched` (and for any shipment not reported before) |
| `confirmed_delivery_deadline` | Optional |
| `locations[].transporter`, `tracking_number`, `dispatched_at`, `delivered_at` | Optional; the two times default to `changed_at` |

Unknown fields are refused. The answer:

```json
{ "data": { "handover_number": "HO-2027-0001", "applied": true, "crm_status": "packed", "oms_stage": "dispatched",
            "recorded_steps": [] },
  "message": "Update applied." }
```

### Stages and CRM status

| OMS `stage` | CRM status |
|---|---|
| (handover approved) | `ready` |
| `accepted` | `accepted` |
| `design_and_procurement` | `production` |
| `warehouse_ready` | `production` (the OMS stage is kept too) |
| `packing` | `packed` |
| `dispatched`, not all kits | `packed` (partly dispatched) |
| `dispatched`, all kits | `dispatched` |
| `delivered`, not all kits | `dispatched`, or `packed` while kits are still to leave |
| `delivered`, all kits | `delivered` |
| `on_hold` | `on_hold`; the KAM is told |
| `cancelled` | `cancelled` |

The mapping is in one place: `src/modules/orders/handover_rules.py`. The stage names are **to be confirmed with the
OMS developer**.

"All kits" means: every location has a shipment with at least its `quantity` (at least 1 when it has none), and the
shipments add up to at least `total_kits`.

### Rules

- **Older or repeated messages** (`changed_at` not later than the last one applied) answer 200 with
  `applied: false` and change nothing. Give every message its own `changed_at`, and send them in order: an older one
  arriving late is dropped, including its shipment details.
- **Never backwards:** an earlier stage with a newer time keeps the CRM status (shipment details are still saved).
- **Skipped stages** are filled in and each is logged. The CRM's `quality_check` has no OMS stage and is not filled in.
- **Hold:** allowed from any open status. A later stage resumes from where it was held.
- **Final:** `delivered` and `cancelled` do not change.
- **Cancel asked in the OMS:** send `on_hold` with a note; the KAM decides. Send `cancelled` only once it is decided.
- **Shipments** are told apart by `location_ref` + `tracking_number`, so a retry does not double the kits. With two
  shipments to one location, send `tracking_number` with each update. `kits` is the total of that shipment.
- **One OMS order:** a different `oms_order_id` for the same handover answers 409.

## 4a. Send payment status

### `POST /handovers/{handover_number}/payment`

```json
{ "payment_status": "success", "changed_at": "2027-01-06T09:00:00Z" }
```

`payment_status` is `pending` or `success`. Send it when OMS Finance changes it; it may come before the first stage
(no OMS order is needed). Until then the CRM shows **Pending**. The CRM only shows the status: it changes no payment
record and no order stage. Repeats and older messages answer 200 with `applied: false`.

## 5. Errors

| Status | Meaning | What to do |
|---|---|---|
| 401 | Missing or wrong key | Check the key |
| 404 | No approved handover with that number | Stop; ask TOFAA |
| 409 | Another `oms_order_id` is linked, or the order changed meanwhile | Read the handover again, then resend |
| 422 | Bad body, unknown `location_ref`, or `changed_at` in the future | Fix the request (`data.errors` says what) |
| 503 | The CRM database is not ready | Retry later |

## 6. CRM side

Delivery details (deadline, advance %, addresses, sample yes/no, quantity per kit, item photos) are asked **once, on the
agreement**, and fill the handover. Saving the agreement again carries only what changed into the handover, which then
needs approval again.

| Action | Who | Where |
|---|---|---|
| Start (needs a signed agreement; or open an existing deal) | KAM, manager, admin | Lead page, Deals |
| Prepare, send for approval, cancel | KAM (own clients), manager, admin | Deal page |
| Approve or reject | Sales Manager, admin | Approvals, deal page |

CRM-only endpoints (signed-in users, camelCase): `POST /orders/handover/from-lead/{leadId}`,
`GET|PUT /orders/by-id/{id}/handover`, `POST …/handover/files|submit|decision|cancel`, `GET /approvals/handovers`.

- Changing the delivery date or instructions on the order also returns the handover to draft.
- A deal the OMS has seen cannot be deleted: cancel its handover.
- The status comes only from the OMS. The CRM has no manual status buttons and no manual creation of deals.
- The deal is marked Won when the OMS sends its Order number, not when the payment status changes.

## 7. Setup (TOFAA)

1. In the **CRM** database run `supabase/migrations/20261130100000_oms_handover.sql` (after
   `20261129100000_order_flow.sql`), then `20261201100000_oms_payment_status.sql` and `20261202100000_deal_numbers.sql`. Both are safe to run twice. The first
   gives existing open orders from deals a draft handover.
2. Set `OMS_INBOUND_KEY` in the CRM backend `.env` to a new random secret of at least 32 characters
   (`python -c "import secrets; print(secrets.token_urlsafe(48))"`), one per environment, and restart.
3. Give the OMS team the base URL, the key (privately), this document and `oms-handover.openapi.json`.
4. Put a request-rate limit on `/api/v1/handovers` at the web server or proxy in front of the CRM.

After an API change, refresh the Swagger file: `python scripts/export_oms_openapi.py`.

## 8. To confirm with the OMS team

1. The stage names in section 4, and `warehouse_ready` -> `production`.
2. One kit type per handover, or a `kits[]` list in a later version.
3. Test and live base URLs.
4. Gift-request orders (`/gift-orders`) are **not** part of v1.

## Testing

```bash
curl -H "X-API-Key: $KEY" "$BASE"
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"oms_order_id":"t1","oms_order_number":"TOF-ORD-2027-00001","stage":"accepted","changed_at":"2027-01-06T10:00:00Z"}' \
  "$BASE/HO-2027-0001/status"
```
