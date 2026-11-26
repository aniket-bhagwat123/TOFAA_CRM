# CRM and Gifting OS: integration, OMS contract and rollout

The CRM is the KAM's screen. Gifting OS keeps gift requests, occasions, events and its own rules. People and groups
are mastered in the CRM and copied to Gifting OS. Budgets and credits are not managed from the CRM.

## 1. Switches

| Setting | File | Default | Effect |
|---|---|---|---|
| `CRM_KAM_ACTIONS_ENABLED` | Gifting OS backend `.env` | `false` | `true` lets CRM users change gifting data |
| `GIFTING_PILOT_EMAILS` | CRM backend `.env` | empty | Only these CRM users may change anything; empty = all KAMs and admins |
| `OMS_API_URL`, `OMS_API_KEY` | CRM backend `.env` | empty | Set both to replace "Start fulfilment" with "Send to OMS" |
| `OMS_WEBHOOK_SECRET` | CRM backend `.env` | empty | Needed to accept status updates from OMS |
| `OS_KAM_LOGIN_DISABLED` | Gifting OS backend `.env` | `false` | `true` stops KAMs using Gifting OS |

Restart the backend after changing its `.env`. Keep `KAM_ACCESS_ALL_CLIENTS=true` in Gifting OS: the hidden CRM
profiles rely on it, and the CRM already limits each KAM to their own accounts.

## 2. OMS contract (proposed; the OMS team to confirm)

### Send an order: CRM calls OMS

`POST {OMS_API_URL}/gift-orders`

Headers: `X-API-Key: <OMS_API_KEY>`, `Idempotency-Key: <gift request id>`

```json
{
  "requestId": "uuid", "requestCode": "TG-0001", "title": "Gift for A. Person",
  "client": {"accountId": "uuid", "name": "Client name"},
  "recipient": {"name": "A. Person", "mobile": "+919999999999"},
  "occasion": "Diwali", "deliveryDate": "2027-01-31", "deliveryAddress": "...",
  "budget": "2500.00",
  "chosenOption": {"name": "Hamper", "description": "...", "price": "2400.00"},
  "message": "...", "specialInstructions": "...", "sentBy": "KAM name"
}
```

Reply with any 2xx and `{"reference": "<OMS order number>"}`.

**OMS must treat a repeated `Idempotency-Key` as the same order** and return the same reference.
`chosenOption` is `null` when the request has several options and none is recorded as chosen.
Optional fields may be `null`.

### Report status: OMS calls the CRM

`POST {CRM backend}/api/v1/integrations/oms/status`

Header: `X-OMS-Signature: sha256=<hex HMAC-SHA256 of the exact body, keyed with OMS_WEBHOOK_SECRET>`

```json
{"requestId": "uuid", "status": "DISPATCHED", "reference": "OMS-123"}
```

`status` is `DISPATCHED` or `DELIVERED`.

| Reply | Meaning | OMS should |
|---|---|---|
| 200 | Applied, or already applied | Stop |
| 403 | Bad signature, or changes are switched off in Gifting OS | Stop and report |
| 404 | Unknown request | Stop and report |
| 409 | The request cannot move to that status | Stop and report |
| 422 | Bad body | Fix the body |
| 502 | Gifting OS unreachable | Retry with a delay |

### Testing without OMS

Run `python scripts/mock_oms.py` in the CRM backend, then set `OMS_API_URL=http://127.0.0.1:8100` and
`OMS_API_KEY=local-oms-key`. This still changes the real request in the connected Gifting OS database, so use a
test client.

## 3. Pilot with 1-2 KAMs

1. Set `GIFTING_PILOT_EMAILS` to the pilot KAMs' CRM emails (add an admin if one should help).
2. Set `CRM_KAM_ACTIONS_ENABLED=true`. Restart both backends.
3. With a test client, each pilot KAM checks:
   - [ ] Sees only their own accounts
   - [ ] Creates an occasion and a personal event
   - [ ] Creates a gift request; it appears in Gifting OS
   - [ ] Start review, ask for information, send a proposal
   - [ ] Client approves in Gifting OS
   - [ ] Start fulfilment (or Send to OMS), dispatched, delivered
   - [ ] History shows the KAM's name followed by "(TOFAA CRM)"
   - [ ] Invites a client user (use a mailbox you control)
   - [ ] A new request raises a bell alert
4. Run on real clients for an agreed period. Note every time a KAM still has to open Gifting OS.
5. Clear `GIFTING_PILOT_EMAILS` to open it to all KAMs and admins.

## 4. Remove the OS KAM role (last)

Do this only when the pilot found nothing a KAM still needs Gifting OS for. Some Gifting OS work is **not in the
CRM**: budgets, credits, contract workspace, gift ideas, proposal photos, editing or cancelling an existing
request, and editing occasions and events. Decide who handles each before switching off.

1. Tell the KAMs the date.
2. Set `OS_KAM_LOGIN_DISABLED=true` and restart the Gifting OS backend. KAMs then see "Key account managers now
   work in TOFAA CRM".
3. To undo, set it back to `false`. No account or history is deleted.

Deleting the KAM role from the database is not included: history and the hidden CRM profiles use it.

## 5. Production checklist

- [ ] Gifting OS database has `20261127100000_groups_from_crm.sql`
- [ ] Both backends deployed, with `https` URLs for each other and for OMS
- [ ] `GIFTING_OS_API_KEY` (CRM) equals `CRM_API_KEY` (Gifting OS), 32 characters or more
- [ ] Email sending configured in Gifting OS (needed for invitations)
- [ ] Both frontends deployed
