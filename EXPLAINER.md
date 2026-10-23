# MiniLedger: Code Explainer

How to use this: walk the request path in order — **phone → OTP → token → loans** — and for each file say *what it does* and *why it is written that way*.

## The 30-second pitch

"MiniLedger lets a user log in with a phone OTP and track money lent to friends. The backend is Express + TypeScript on PostgreSQL with plain SQL. The mobile app is Expo/React Native. Auth is a mock OTP that is hashed in the database and exchanged for a JWT. Every loan query is scoped to the logged-in user, and overdue status and summary totals are calculated in SQL."

---

## Backend (`backend/`)

### Entry and wiring

| File | What it does | Why |
|------|--------------|-----|
| `src/index.ts` | Calls `app.listen()`. The only file that opens a port. | Keeps the app importable by tests without starting a server. |
| `src/app.ts` | Creates the Express app: JSON parsing, static `/uploads`, `/health`, the two routers, then 404 and error handlers. **Exports `app`.** | supertest imports this directly. Middleware order matters: error handler goes last. |
| `src/config.ts` | Reads `.env` once and exposes typed settings (port, DB URL, JWT secret, OTP rules, upload limit). | One place for magic numbers; the tests and code share the same limits. |
| `src/db.ts` | One shared `pg` connection `Pool` and a small `query(sql, params)` helper. | A pool reuses connections. The helper nudges everyone toward `$1, $2` parameters. |
| `src/types.ts` | `LoanRow` (DB shape), `Loan` (JSON shape), `Summary`, `HttpError`, and a typing so `req.user` exists. | The DB returns `NUMERIC` as a string; the API returns a number. Separate types make that conversion explicit. |

### Middleware

| File | What it does | Why |
|------|--------------|-----|
| `middleware/auth.ts` | Reads `Authorization: Bearer <jwt>`, verifies it, sets `req.user.id`. Otherwise 401. | Every loans route calls `loansRouter.use(requireAuth)`, so no route can forget it. |
| `middleware/validate.ts` | `validate(zodSchema, 'body' \| 'params')`. On failure returns `400 {error, details:[{field,message}]}`; on success replaces the input with the parsed (trimmed, converted) data. Also deletes an already-uploaded receipt if the rest of the form is invalid. | One reusable validator instead of `if` checks in each route. Handlers receive clean, typed data. |
| `middleware/errorHandler.ts` | `asyncHandler` (forwards promise rejections), `notFound`, and `errorHandler` which maps `HttpError`, multer errors, bad JSON and unexpected errors to `{error: string}`. | Express 4 doesn't catch async errors by itself. One handler guarantees a consistent error format and hides internals from clients. |

### Routes

**`routes/auth.ts`**

- `POST /auth/request-otp`: validate phone → count OTPs for that phone in the last 10 minutes (≥5 → 429) → generate a code → store `sha256(phone:code)` with an expiry computed by the DB → `console.log` the code → respond `{message:"OTP sent"}` (never the code).
- `POST /auth/verify-otp`: find the **latest unused, unexpired** OTP → reject if 5 attempts used → **increment attempts first** (atomic UPDATE with an `attempts < 5` guard) → compare hashes in constant time → mark `used` (guarded by `used = false`) → upsert the user (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) → sign a 7-day JWT.

**`routes/loans.ts`**

- `LOAN_COLUMNS`: the SQL column list used by every query. It formats `due_date` as text and computes `is_overdue` / `days_overdue` in SQL.
- `mapLoan()`: converts `amount` from string to number and dates to ISO strings.
- zod schemas: `amount` accepts a string (multipart) or number (JSON), then checks a regex for ≤ 2 decimals, > 0, ≤ 10,000,000. `due_date` must match `YYYY-MM-DD` *and* be a real date. `id` must be a UUID.
- multer: disk storage, random UUID filename, extension chosen from the MIME type (not the client's filename), 5 MB limit, JPEG/PNG/WebP only.
- `GET /loans/summary`: one aggregate query with `FILTER` clauses and `COALESCE(…, 0)`.
- `GET /loans`: `ORDER BY is_repaid ASC, due_date ASC`.
- `POST /loans`: multer → validate → insert → 201. Deletes the file if the insert fails.
- `PATCH /loans/:id/repay`: one atomic `UPDATE … WHERE id AND user_id AND is_repaid = false`. If no row changed, a second query decides 404 vs 409.

### Services, DB, scripts

| File | What it does |
|------|--------------|
| `services/otp.ts` | `generateOtp` (crypto-secure 6 digits), `hashOtp` (SHA-256 with the phone as salt), `otpMatches` (constant-time compare), `deliverOtp` (the mock "SMS" log line). Swapping in a real SMS provider only touches `deliverOtp`. |
| `migrations/001_init.sql` | Creates `users`, `otps`, `loans`, indexes. Uses `IF NOT EXISTS` so it is safe to re-run. |
| `scripts/migrate.ts` | Runs every `.sql` file in `migrations/` in order. Exports `runMigrations` so tests build the schema the same way. |
| `scripts/seed.ts` | Demo user `+919999999999` and 5 loans (2 overdue, 2 pending, 1 repaid) with dates relative to today. |

### Tests (`backend/tests/`)

| File | What it does |
|------|--------------|
| `setupEnv.ts` | Points `DATABASE_URL` at the test DB and **refuses to run unless the name contains "test"** (the tests truncate tables). |
| `helpers.ts` | `setupDatabase`, `resetDatabase` (TRUNCATE), `requestOtpAndCapture` (spies on `console.log` to read the OTP), `login`, `createLoan`. |
| `auth.test.ts` | OTP validation, hash stored not code, rate limit, full login, wrong/expired/reused OTP, attempt lockout. |
| `loans.test.ts` | 401 without token, create (JSON + multipart), receipt rules, validation table, sorting + overdue, user isolation, repay/409/404, summary maths with inserted past-due rows. |

---

## Mobile (`mobile/`)

| File | What it does |
|------|--------------|
| `index.ts` | `registerRootComponent(App)`: the Expo entry point. |
| `App.tsx` | Wraps the app in `AuthProvider` + `NavigationContainer`. `RootNavigator` shows a splash while checking for a saved login, then **either** the Loans/AddLoan screens (logged in) **or** the Login screen. Logging in/out swaps the screen set automatically. |
| `src/theme.ts` | Colors, spacing, radius, font sizes: one place for the look. |
| `src/api/client.ts` | axios instance (base URL from `EXPO_PUBLIC_API_URL`), request interceptor adds the Bearer token, response interceptor calls logout on 401 **only if a token existed** (so a wrong OTP doesn't log out). Typed API functions and error helpers. |
| `src/context/AuthContext.tsx` | React Context holding `token`, `user`, `loading`; `signIn` / `signOut`; stores the token in `expo-secure-store` (Keychain/Keystore); restores it on app start. |
| `src/screens/LoginScreen.tsx` | Two steps in one screen (`step` state): phone → OTP. Loading spinners, inline errors, "Change number", hint about the server console. |
| `src/screens/LoansScreen.tsx` | Loads loans + summary together; `useFocusEffect` reloads whenever the screen is focused (this is how the list refreshes after adding). Pull-to-refresh, empty state, confirm-before-repay alert, receipt modal, FAB, logout button. |
| `src/screens/AddLoanScreen.tsx` | Form with client-side validation mirroring the server, date picker (Android dialog / iOS compact), receipt from camera or gallery with preview/remove, multipart upload, maps server field errors onto inputs. |
| `src/components/SummaryCard.tsx` | The four totals; Overdue in red. |
| `src/components/LoanItem.tsx` | One loan row with three states: Pending, **Overdue** (red tint, red border, "Overdue by N days"), Repaid (grey, green badge). |
| `src/utils/format.ts` | `₹` formatting (Indian grouping), safe date formatting without timezone shifts, local `YYYY-MM-DD`. |

---

## 10 likely interview questions

**1. Why store a hash of the OTP instead of the OTP?**
If the database leaks, plain codes would be directly usable. A hash can't be reversed. A 6-digit space is small enough to brute-force offline, so the real protection is the short expiry, single use and 5-attempt cap. In production I would also use an HMAC with a server-side secret.

**2. Why `NUMERIC(12,2)` and not `FLOAT`?**
Floats can't represent many decimals exactly (0.1 + 0.2 ≠ 0.3), which is unacceptable for money. `NUMERIC` is exact. `pg` returns it as a string to avoid precision loss, so I convert to a number in `mapLoan`. That's safe here because amounts are capped at 10,000,000 with 2 decimals.

**3. How do you stop one user from seeing or changing another user's loans?**
The JWT middleware sets `req.user.id`, and every query has `WHERE user_id = $n`. For repay, the `UPDATE` includes `user_id`, so a foreign id matches no rows. I return 404 (not 403) so attackers can't learn which ids exist. A test covers this.

**4. Why compute `is_overdue` in SQL instead of in JavaScript or storing it?**
Storing it would go stale at midnight. Computing in the database uses one clock and one timezone, and the list and summary use the same expression, so they can't disagree. The trade-off is that it uses the DB server's timezone.

**5. How does the summary avoid several queries and avoid nulls?**
One `SELECT` with `SUM(...) FILTER (WHERE ...)` and `COUNT(*) FILTER (...)` over the user's rows. `SUM` of no rows is `NULL`, so each is wrapped in `COALESCE(…, 0)`. `COUNT` returns bigint (a string in `pg`), so I convert with `Number`.

**6. What stops someone brute-forcing the OTP?**
Max 5 attempts per OTP, 5-minute expiry, one use, and max 5 OTP requests per phone per 10 minutes. The attempt counter is incremented *before* comparing, in one atomic UPDATE with a guard, so parallel requests can't squeeze in extra guesses.

**7. What does the repay endpoint do if two requests arrive at the same time?**
It is one atomic `UPDATE … WHERE is_repaid = false`. Postgres locks the row, so only one request updates it. The other updates zero rows and gets 409.

**8. Why is `app.ts` separate from `index.ts`?**
`app.ts` builds and exports the Express app; `index.ts` calls `listen()`. Tests import `app` into supertest, which makes requests in-process with no port conflicts.

**9. How are file uploads kept safe?**
multer allows only JPEG/PNG/WebP and 5 MB, saves with a random UUID name, and picks the extension from the MIME type instead of trusting the client's filename. Static files are served with `X-Content-Type-Options: nosniff`. Limitation: the MIME type comes from the client, so a real deployment should also check the file's magic bytes and use private storage.

**10. How does the mobile app keep the user logged in, and how does it handle an expired token?**
After login the JWT is saved with `expo-secure-store` (Keychain/Keystore). On startup `AuthContext` reads it while a splash is shown. An axios interceptor attaches it to every request; if a response is 401 *and* a token was set, it calls `signOut`, and because navigation depends on `token`, the app switches to the Login screen automatically.

*Bonus:* **"What would you do next?"** Real SMS provider, refresh tokens, private S3 receipts with signed URLs, loan edit/delete and partial repayments, pagination, push reminders for due dates, and CI running the tests.
