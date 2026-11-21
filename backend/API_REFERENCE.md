# API Reference

Base path `/api/v1`. Auth: `Authorization: Bearer <access_token>`. Envelope: `{ "data", "message" }`.
Full interactive docs at `/api/v1/docs` (non-production).

| Method | Path | Notes |
|---|---|---|
| POST | /auth/login | `{email, password}` -> `{profile, tokens}`. **409** `already_signed_in` if the account has another active session |
| POST | /auth/refresh | `{refreshToken}`; 401 if the session was replaced or expired |
| POST | /auth/logout | releases the session so the user can sign in elsewhere |
| POST | /auth/forgot-password | `{email}` |
| POST | /auth/reset-password | `{accessToken, newPassword}` |
| GET | /auth/me | current profile |
| GET | /health, /health/live, /health/ready | outside `/api/v1` |

## Single session

Each user may hold one session. A second login with correct credentials is rejected (409) until the
first signs out or is idle for `SESSION_IDLE_MINUTES` (default 30). Every authenticated request
refreshes the idle timer; a token whose session no longer owns the account gets 401.

## Users

| Method | Path | Notes |
|---|---|---|
| POST | /users | `{email, password, fullName?, role?}` -> user. `superadmin` may create any role; `admin` may create only `user`; `user` gets 403. 409 if the email exists. Password: 8+ chars with upper, lower and a digit. `role` defaults to `user` |
