# TOFAA CRM — Order API for the OMS

The CRM creates an order when a client's payment is complete (or a KAM makes one by hand). The KAM releases it. The
OMS then reads it, moves it through the fulfilment stages and records the shipment. The OMS cannot create, edit or
delete orders.

## Connection

| | |
|---|---|
| Base URL | `https://<crm-api-host>/api/v1/oms/orders` |
| Authentication | Header `X-API-Key: <key>` on every call. TOFAA shares the key privately. |
| Format | JSON. Dates `YYYY-MM-DD`, times ISO 8601. Money in rupees. |
| Transport | HTTPS only. |

Every answer is `{ "data": ..., "message": "..." }`. Errors use the same shape with an HTTP error status.

## Stages

```
ready -> accepted -> production -> quality_check -> packed -> dispatched -> delivered
  |
  +-> rejected (the KAM corrects it and releases it again)
```

| Current stage | OMS may set |
|---|---|
| `ready` | `accepted`, `rejected` (note required) |
| `accepted` | `production`, `on_hold` |
| `production` | `quality_check`, `on_hold` |
| `quality_check` | `packed`, `production` (check failed), `on_hold` |
| `packed` | `dispatched`, `on_hold` |
| `dispatched` | `delivered` |
| `on_hold` | the stage it was in before (note required to hold) |
| `delivered`, `cancelled`, `rejected` | nothing |

TOFAA staff may also change a stage (for example cancel an order), so read the order before assuming its stage.

## 1. List orders

`GET /?status=ready&updatedSince=2027-01-01T00:00:00Z&page=1&limit=25`

All parameters are optional; `limit` is at most 100. Only released orders are listed, oldest change first. Poll with
`updatedSince` set to the latest `updatedAt` you have seen (an order may then be repeated; treat that as normal).
In a URL, write the `+` of a time zone as `%2B`.

## 2. One order

`GET /{orderNumber}` — for example `GET /ORD-00012`

```json
{
  "orderNumber": "ORD-00012", "status": "ready", "omsReference": null,
  "createdAt": "…", "releasedAt": "…", "updatedAt": "…",
  "client": { "name": "Client Pvt Ltd", "billingName": "…", "billingGstin": "…" },
  "contact": { "name": "…", "phone": "…", "email": "…" },
  "accountManager": "KAM name",
  "delivery": { "expectedDate": "2027-01-31", "address": "…", "receiverName": "…", "receiverPhone": "…", "instructions": "…" },
  "items": [
    { "line": 1, "name": "Festive hamper", "quantity": 100, "unitPrice": 1250, "amount": 125000,
      "gstAmount": 22500, "lineTotal": 147500,
      "contents": [{ "name": "Dry fruit box", "description": "500 g" }], "photoUrls": ["https://…"] }
  ],
  "totals": { "units": 100, "subtotal": 125000, "transportation": 0, "gstRate": 18, "gstAmount": 22500, "total": 147500 },
  "shipment": { "courier": null, "trackingNumber": null, "trackingUrl": null },
  "nextStatuses": ["accepted", "rejected"]
}
```

Photo links expire after one hour; download the pictures or ask for the order again.

## 3. Change the stage

`POST /{orderNumber}/status`

```json
{ "status": "accepted", "note": "Planned for next week", "omsReference": "OMS-1021" }
```

`note` is required for `rejected` and `on_hold`. Sending the stage the order is already in changes nothing and
answers 200, so a retry is safe. A stage that is not allowed answers 409 with the allowed ones.

## 4. Shipment

`PUT /{orderNumber}/shipment`

```json
{ "courier": "BlueDart", "trackingNumber": "BD123", "trackingUrl": "https://…", "expectedDelivery": "2027-01-30" }
```

Send only the fields to change. Allowed from `accepted` until `dispatched` (and while on hold).

## 5. History

`GET /{orderNumber}/history` — every stage change with time, note and who (`OMS` or the TOFAA person's side).

## Errors

| Status | Meaning | What to do |
|---|---|---|
| 401 | Missing or wrong key | Check the key |
| 404 | No such released order | Stop; ask TOFAA |
| 409 | The stage change or shipment is not allowed now, or the order changed meanwhile | Read the order again |
| 422 | Bad body | Fix the request |
| 503 | The CRM database is not ready | Retry later |

## Testing

```bash
curl -H "X-API-Key: $KEY" "$BASE?status=ready"
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" -d '{"status":"accepted"}' "$BASE/ORD-00012/status"
```

## Setup (TOFAA)

1. Apply `supabase/migrations/20261129100000_order_flow.sql` to the CRM database.
2. Set `OMS_INBOUND_KEY` in the CRM backend `.env` to a random secret of at least 32 characters
   (`python -c "import secrets; print(secrets.token_urlsafe(48))"`) and restart the backend.
3. Give the OMS team the base URL, the key (privately) and this document. To replace a key, change it and restart.
4. Put a request-rate limit on `/api/v1/oms/` at the web server or proxy in front of the CRM.
