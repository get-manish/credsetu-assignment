# Credestu Assignment

## Credestu Assignment — MiniLedger

MiniLedger is a small full-stack app for tracking **money you lend to friends**. You log in with a phone number and a mock OTP, record who owes you what and when it is due, attach a receipt photo, see overdue loans highlighted in red, and mark loans as repaid.

It is intentionally small but production-shaped: parameterized SQL, hashed OTPs, JWT auth, per-user data isolation, validated uploads, and a typed React Native client.

- **Backend:** Node.js + TypeScript + Express + PostgreSQL
- **Mobile:** React Native with Expo + TypeScript
- **Auth:** mock OTP (printed to the server log) exchanged for a JWT
- **Money:** exact `NUMERIC(12,2)` values, never floating point

---

## Table of contents

- [Architecture](#architecture)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [API reference](#api-reference)
- [Database schema](#database-schema)
- [Design decisions](#design-decisions)
- [Running the tests](#running-the-tests)
- [Troubleshooting](#troubleshooting)
- [Known limitations and next steps](#known-limitations-and-next-steps)
- [Demo script](#demo-script)
- [Further reading](#further-reading)

---

## Architecture

```mermaid
flowchart LR
  subgraph Device["Android / iOS device"]
    App["MiniLedger mobile app\nExpo + React Native"]
    Secure["expo-secure-store\nJWT (Keychain / Keystore)"]
  end

  subgraph Docker["Docker Compose"]
    API["Express API\nNode.js + TypeScript"]
    DB[("PostgreSQL 16\nusers · otps · loans")]
    Files[("uploads/\nreceipt images")]
  end

  App -- "JSON over HTTP\nAuthorization: Bearer JWT" --> API
  API -- "SQL via pg Pool\nparameterized queries" --> DB
  API -- "multer\nJPEG / PNG / WebP" --> Files
  App -. "persist session" .-> Secure
```

The mobile app never talks to PostgreSQL directly. Every request goes through the API, which authenticates the JWT and scopes all loan queries to the logged-in user.

### Login flow

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant App as Mobile app
  participant API as Express API
  participant DB as PostgreSQL

  User->>App: Enter phone number
  App->>API: POST /auth/request-otp { phone }
  API->>DB: Count recent OTPs for this phone
  alt More than 5 requests in 10 minutes
    API-->>App: 429 Too many OTP requests
  else Within limit
    API->>DB: INSERT sha256(phone:code) with 5-minute expiry
    API-->>API: console.log("[MOCK OTP] phone -> code")
    API-->>App: 200 { message: "OTP sent" }
  end

  User->>App: Read OTP from server log
  App->>API: POST /auth/verify-otp { phone, otp }
  API->>DB: Find latest unused, unexpired OTP
  API->>DB: Increment attempts, compare hash, mark used
  API->>DB: Upsert user by phone
  API-->>App: 200 { token, user }
  App->>App: Save JWT in SecureStore
  App-->>User: Show Loans screen
```

### Loan lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant App as Mobile app
  participant API as Express API
  participant DB as PostgreSQL

  App->>API: GET /loans + GET /loans/summary (Bearer JWT)
  API->>DB: SELECT loans WHERE user_id = $1
  Note over API,DB: is_overdue and days_overdue are computed in SQL
  API-->>App: Loan list + totals

  App->>API: POST /loans (JSON or multipart receipt)
  API->>API: requireAuth, zod validation, multer
  API->>DB: INSERT loan
  API-->>App: 201 Created loan

  App->>API: PATCH /loans/:id/repay
  API->>DB: UPDATE ... WHERE user_id = $1 AND is_repaid = false
  alt Row updated
    API-->>App: 200 Updated loan
  else Already repaid
    API-->>App: 409 Conflict
  else Missing or belongs to another user
    API-->>App: 404 Not found
  end
```

### Loan status

```mermaid
stateDiagram-v2
  [*] --> Pending: create loan
  Pending --> Overdue: due_date < CURRENT_DATE
  Pending --> Repaid: mark as repaid
  Overdue --> Repaid: mark as repaid
  Repaid --> [*]
```

`Overdue` is not stored in the database. It is derived from `is_repaid` and `due_date`, so it can never become stale.

---

## How it works

### Authentication

1. The user submits a phone number.
2. The API creates a random 6-digit OTP, stores only its SHA-256 hash, and logs the plain code to the server console.
3. The user types the code from the log.
4. The API verifies the hash, consumes the OTP, creates the user if needed, and returns a 7-day JWT.
5. The mobile app stores the JWT in `expo-secure-store`.
6. Every protected request sends `Authorization: Bearer <token>`.
7. Any `401` for a request made with a token logs the user out automatically.

The OTP is never returned by the API. It expires after 5 minutes, can be used once, and allows 5 attempts. A phone can request at most 5 OTPs per 10 minutes.

### Loans

Each loan belongs to exactly one user and contains:

- friend name
- exact amount
- due date
- optional receipt image
- repaid flag and timestamp

The API returns two computed fields for each loan:

- `is_overdue`: `NOT is_repaid AND due_date < CURRENT_DATE`
- `days_overdue`: how many days past the due date

The summary endpoint returns total lent, total repaid, outstanding, overdue amount, loan count, and overdue count. All totals are computed by PostgreSQL in one aggregate query.

### Mobile app

- **Login screen:** phone entry, then OTP entry, with inline errors and loading states.
- **Loans screen:** summary card, loan list, pull-to-refresh, receipt viewer, logout, and a floating **+** button.
- **Add loan screen:** friend name, amount, due date, and optional receipt from camera or gallery.
- **Overdue highlighting:** red-tinted card, red left border, red **Overdue** badge, and "Overdue by N days".
- **Repaid loans:** greyed out with a green **Repaid** badge.

---

## Repository layout

```text
miniledger/
├── docker-compose.yml          PostgreSQL + migrations/seed + API
├── README.md                   This file
├── EXPLAINER.md                File-by-file walkthrough and interview Q&A
│
├── backend/
│   ├── migrations/
│   │   └── 001_init.sql        users, otps, loans tables and indexes
│   ├── scripts/
│   │   ├── migrate.ts          Runs every migrations/*.sql file
│   │   └── seed.ts             Demo user + 5 sample loans
│   ├── src/
│   │   ├── app.ts              Express app (exported for tests)
│   │   ├── index.ts            Starts the HTTP server
│   │   ├── config.ts           Environment-derived settings
│   │   ├── db.ts               Shared pg Pool + query helper
│   │   ├── types.ts            Shared backend types and HttpError
│   │   ├── middleware/
│   │   │   ├── auth.ts         JWT verification
│   │   │   ├── validate.ts     Zod validation middleware
│   │   │   └── errorHandler.ts Consistent JSON error responses
│   │   ├── routes/
│   │   │   ├── auth.ts         request-otp / verify-otp
│   │   │   └── loans.ts        loans, summary, repay, uploads
│   │   └── services/
│   │       └── otp.ts          Generate, hash, compare, "send" OTP
│   ├── tests/                  Jest + supertest integration tests
│   └── Dockerfile              Multi-stage production build
│
├── mobile/
│   ├── App.tsx                 Navigation, auth gate, splash
│   ├── index.ts                Expo entry point
│   ├── app.json                Expo configuration
│   ├── android/                Generated native Android project
│   └── src/
│       ├── api/client.ts       Axios client, typed API calls, errors
│       ├── context/AuthContext.tsx  Token/user state + SecureStore
│       ├── screens/            Login, Loans, AddLoan
│       ├── components/         SummaryCard, LoanItem
│       ├── utils/format.ts     Currency, dates, local YYYY-MM-DD
│       └── theme.ts            Colors, spacing, typography
│
└── package.json                Repository tooling only
```

---

## Tech stack

| Layer           | Tools                                                             |
| --------------- | ----------------------------------------------------------------- |
| Backend runtime | Node.js 20+ (Docker image uses Node 22), TypeScript strict mode   |
| HTTP            | Express 4                                                         |
| Database        | PostgreSQL 16, `pg` with plain parameterized SQL (no ORM)         |
| Validation      | zod                                                               |
| Auth            | jsonwebtoken, SHA-256 hashed OTPs, `crypto.randomInt`             |
| Uploads         | multer disk storage, 5 MB limit                                   |
| Backend tests   | jest, ts-jest, supertest                                          |
| Mobile          | Expo SDK 58, React Native 0.88, React 19, React Navigation, axios |
| Mobile storage  | expo-secure-store (Keychain / Android Keystore)                   |
| Mobile extras   | expo-image-picker, @react-native-community/datetimepicker         |
| Dev tooling     | ts-node-dev, Docker Compose                                       |

---

## Quick start

### Prerequisites

- Node.js 20+
- Docker (recommended) **or** a local PostgreSQL 14+
- Expo Go on a phone, or an Android emulator / iOS simulator
- For a physical Android device with `adb`: USB debugging or `adb connect`

### Option A — Everything with Docker Compose

```bash
docker compose up -d --build
```

This starts:

1. **PostgreSQL 16** with a persistent volume.
2. A one-shot container that runs `npm run migrate && npm run seed`.
3. The production-built API on port **4000**.

Check it:

```bash
curl http://localhost:4000/health
# {"status":"ok"}
```

Watch the API logs and mock OTPs:

```bash
docker compose logs -f api
```

The seed creates the demo user **+919999999999** with 5 sample loans (2 overdue).

### Option B — Local backend development

Start only the database:

```bash
docker compose up -d db
```

Then:

```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed          # optional demo data
npm run dev           # API on http://localhost:4000
```

The mock OTP appears in this terminal:

```text
[MOCK OTP] +919999999999 -> 482913
```

### Mobile app

```bash
cd mobile
npm install
npx expo install --fix
cp .env.example .env
npx expo start
```

Then scan the QR code with Expo Go, or run a native build:

```bash
npm run android       # expo run:android
npm run ios           # expo run:ios
```

Restart Expo after changing `.env`, because `EXPO_PUBLIC_*` values are inlined at bundle time.

### Choosing `EXPO_PUBLIC_API_URL`

| Where the app runs                  | `EXPO_PUBLIC_API_URL`              |
| ----------------------------------- | ---------------------------------- |
| Android emulator                    | `http://10.0.2.2:4000`             |
| iOS simulator                       | `http://localhost:4000`            |
| Physical Android with `adb reverse` | `http://localhost:4000`            |
| Physical phone on the same Wi-Fi    | `http://<your-laptop-LAN-IP>:4000` |

For a physical Android device connected through `adb` (USB or wireless debugging), the simplest setup is:

```bash
adb reverse tcp:4000 tcp:4000
```

Then keep `EXPO_PUBLIC_API_URL=http://localhost:4000`. The device's `localhost:4000` is forwarded to your laptop.

> **Android release builds and HTTP:** Android blocks cleartext HTTP by default on modern API levels. This repository already sets `android:usesCleartextTraffic="true"` in `mobile/android/app/src/main/AndroidManifest.xml` for local development. If you regenerate the native project with `expo prebuild`, re-add that setting or use HTTPS.

---

## Environment variables

### Backend (`backend/.env`)

| Variable            | Default                                                           | Purpose                                              |
| ------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `PORT`              | `4000`                                                            | API port                                             |
| `DATABASE_URL`      | `postgres://miniledger:miniledger@localhost:5432/miniledger`      | Main database                                        |
| `TEST_DATABASE_URL` | `postgres://miniledger:miniledger@localhost:5432/miniledger_test` | Test database (must contain "test")                  |
| `JWT_SECRET`        | `dev-only-secret-change-me`                                       | JWT signing secret; change outside local development |
| `OTP_TTL_MINUTES`   | `5`                                                               | OTP lifetime                                         |

OTP attempt limits and upload limits are constants in `backend/src/config.ts`.

### Mobile (`mobile/.env`)

| Variable              | Example                 | Purpose                               |
| --------------------- | ----------------------- | ------------------------------------- |
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000` | API base URL baked into the JS bundle |

---

## API reference

Base URL: `http://localhost:4000`

Errors always look like `{"error":"message"}`. Validation errors also include `details`:

```json
{
  "error": "Validation failed",
  "details": [
    {
      "field": "amount",
      "message": "Amount must be a positive number with at most 2 decimal places"
    }
  ]
}
```

Protected routes require:

```http
Authorization: Bearer <token>
```

| Method | Path                | Auth | Purpose                                            |
| ------ | ------------------- | ---- | -------------------------------------------------- |
| GET    | `/health`           | –    | Liveness check                                     |
| POST   | `/auth/request-otp` | –    | Create a mock OTP (max 5 per phone per 10 minutes) |
| POST   | `/auth/verify-otp`  | –    | Exchange phone + OTP for a 7-day JWT               |
| GET    | `/loans`            | Yes  | List my loans, unpaid first, soonest due first     |
| POST   | `/loans`            | Yes  | Create a loan (JSON or multipart with `receipt`)   |
| GET    | `/loans/summary`    | Yes  | Totals computed in SQL                             |
| PATCH  | `/loans/:id/repay`  | Yes  | Mark a loan as repaid                              |

### Request an OTP

```bash
curl -X POST http://localhost:4000/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999"}'
```

```json
{ "message": "OTP sent" }
```

Then read the code from the server log:

```text
[MOCK OTP] +919999999999 -> 482913
```

### Verify the OTP

```bash
curl -X POST http://localhost:4000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+919999999999","otp":"482913"}'
```

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "3f0c1a52-8d0e-4a8e-9a53-6e0b1f6d2c11",
    "phone": "+919999999999"
  }
}
```

Possible errors: wrong, expired, reused, or too many attempts (`401`).

### Create a loan (JSON)

```bash
TOKEN=eyJhbGciOi...

curl -X POST http://localhost:4000/loans \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"friend_name":"Rahul","amount":1500.50,"due_date":"2026-12-01"}'
```

```json
{
  "id": "b6d7c1e0-3b0a-4f4e-8a3d-0f7f1c7d9a10",
  "friend_name": "Rahul",
  "amount": 1500.5,
  "due_date": "2026-12-01",
  "is_repaid": false,
  "repaid_at": null,
  "receipt_url": null,
  "created_at": "2026-10-22T07:10:00.000Z",
  "is_overdue": false,
  "days_overdue": 0
}
```

### Create a loan with a receipt (multipart)

```bash
curl -X POST http://localhost:4000/loans \
  -H "Authorization: Bearer $TOKEN" \
  -F friend_name="Priya" \
  -F amount=800 \
  -F due_date=2026-11-15 \
  -F receipt=@./receipt.jpg
```

The response contains `receipt_url`, for example `/uploads/5d2c...e1.jpg`. Open `http://localhost:4000/uploads/5d2c...e1.jpg` to view it.

Rules:

- `friend_name`: 1–100 characters, trimmed
- `amount`: greater than 0, at most 10,000,000, at most 2 decimal places
- `due_date`: real calendar date in `YYYY-MM-DD`
- `receipt`: JPEG, PNG, or WebP, at most 5 MB

### List loans

```bash
curl http://localhost:4000/loans -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "id": "…",
    "friend_name": "Priya Nair",
    "amount": 800.5,
    "due_date": "2026-10-19",
    "is_repaid": false,
    "repaid_at": null,
    "receipt_url": null,
    "created_at": "2026-10-22T07:10:00.000Z",
    "is_overdue": true,
    "days_overdue": 3
  }
]
```

### Summary

```bash
curl http://localhost:4000/loans/summary -H "Authorization: Bearer $TOKEN"
```

```json
{
  "total_lent": 12500.5,
  "total_repaid": 3000,
  "outstanding": 9500.5,
  "overdue_amount": 3300.5,
  "loan_count": 5,
  "overdue_count": 2
}
```

A user with no loans receives all zeros.

### Mark a loan as repaid

```bash
curl -X PATCH http://localhost:4000/loans/<loan-id>/repay \
  -H "Authorization: Bearer $TOKEN"
```

Returns the updated loan.

- `400` if the id is not a UUID
- `404` if the loan does not exist **or belongs to another user**
- `409` if it is already repaid

---

## Database schema

```mermaid
erDiagram
    USERS {
        uuid id PK
        text phone UK
        timestamptz created_at
    }

    LOANS {
        uuid id PK
        uuid user_id FK
        text friend_name
        numeric amount
        date due_date
        boolean is_repaid
        timestamptz repaid_at
        text receipt_url
        timestamptz created_at
    }

    OTPS {
        serial id PK
        text phone
        text code_hash
        timestamptz expires_at
        int attempts
        boolean used
        timestamptz created_at
    }

    USERS ||--o{ LOANS : owns
```

Notes:

- `LOANS.user_id` has `ON DELETE CASCADE`.
- `OTPS` is matched by `phone`; it has no foreign key to `users` because a user may not exist yet when the OTP is requested.
- `is_overdue` and `days_overdue` are **not stored**; they are calculated in every query.
- The full DDL is in `backend/migrations/001_init.sql`.

---

## Design decisions

- **Hashed OTPs.** Only `SHA-256(phone:code)` is stored. Comparison uses `timingSafeEqual`. Each OTP expires after 5 minutes, works once, and allows 5 attempts.
- **Atomic attempt counting.** The attempt counter is incremented with an `UPDATE ... WHERE attempts < 5` guard _before_ checking the code, so parallel guesses cannot exceed the limit.
- **Rate-limited OTP requests.** At most 5 OTP requests per phone per 10 minutes, enforced by counting recent rows in the `otps` table.
- **Exact money.** `NUMERIC(12,2)` avoids floating-point rounding errors. PostgreSQL returns `NUMERIC` as a string, so `mapLoan()` converts it to a number for JSON.
- **Overdue computed in SQL.** The list and summary share the same expression, so they cannot disagree. Nothing "overdue" is stored that can go stale.
- **Per-user isolation.** Every loan query includes `WHERE user_id = <token user>`. Foreign loans return `404`, not `403`, so ids cannot be probed.
- **Atomic repay.** A single `UPDATE ... WHERE id = $1 AND user_id = $2 AND is_repaid = false` makes double-repay races safe. A follow-up lookup distinguishes `404` from `409`.
- **Parameterized SQL only.** All values use `$1`, `$2`, etc.; no string concatenation of user input.
- **Validated uploads.** Only JPEG/PNG/WebP up to 5 MB. Files get a random UUID name and a server-chosen extension; the client filename is never trusted.
- **Testable app wiring.** `app.ts` exports the Express app without listening. `index.ts` calls `listen()`. Supertest imports the app directly.
- **JWT in SecureStore.** The mobile app keeps the token in the iOS Keychain / Android Keystore. An axios response interceptor logs out on `401` only when a token was actually attached, so a wrong OTP does not trigger a logout loop.
- **Navigation follows auth state.** `App.tsx` swaps the whole screen set when the token appears or disappears, so there is no "back" navigation into a stale authenticated screen.

---

## Running the tests

The backend tests use a **separate database** and truncate tables before each test.

Create the test database once:

```bash
docker compose up -d db
docker compose exec db createdb -U miniledger miniledger_test
```

Then:

```bash
cd backend
npm test
```

`backend/tests/setupEnv.ts` refuses to run if the configured database name does not contain `"test"`.

The suite covers:

- phone and OTP validation
- hashing and the full login flow
- wrong, expired, reused, and over-attempted OTPs
- OTP rate limiting
- authentication on `/loans`
- loan creation with JSON and multipart bodies
- receipt type/size rules and validation failures
- list ordering and overdue calculation
- repay, double-repay `409`, missing/foreign loan `404`
- per-user data isolation
- summary maths with repaid, pending, and overdue loans

The mobile app currently has no automated tests; run TypeScript checks with:

```bash
cd mobile
npm run typecheck
```

---

## Troubleshooting

### The app says "Cannot reach the server"

1. Confirm the API is running:

   ```bash
   curl http://localhost:4000/health
   ```

2. Confirm the app's `EXPO_PUBLIC_API_URL` matches where it runs (see the table above).
3. For a physical Android device with `adb`, run:

   ```bash
   adb reverse tcp:4000 tcp:4000
   adb reverse --list
   ```

   Then use `http://localhost:4000`.

4. Restart Expo after editing `.env`. `EXPO_PUBLIC_*` values are inlined at bundle time.
5. If you changed the Android manifest or native code, rebuild and reinstall:

   ```bash
   cd mobile/android
   ./gradlew assembleRelease
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```

6. Check that your firewall allows port 4000 when using a LAN IP.

### No OTP appears

- Local backend: look at the terminal running `npm run dev`.
- Docker backend: run `docker compose logs -f api`.
- The code is never returned in the HTTP response by design.

### Android release build cannot make HTTP requests

Android blocks cleartext HTTP by default. This repository's main manifest sets:

```xml
android:usesCleartextTraffic="true"
```

If you run `expo prebuild` and regenerate `mobile/android/`, re-add that attribute or switch the API to HTTPS.

---

## Known limitations and next steps

- The OTP is mocked to the console. Production needs an SMS provider (Twilio, MSG91, etc.) and per-IP rate limiting.
- JWTs cannot be revoked before expiry. Add refresh tokens or a revocation list.
- Receipts are stored on local disk and served by unguessable URLs. Production should use private object storage (for example S3) with signed URLs and verify file contents, not just the declared MIME type.
- `CURRENT_DATE` uses the database server's timezone, so "overdue" flips at midnight in that zone.
- Phone numbers are not normalized: `+919876543210` and `919876543210` are different users.
- No edit/delete for loans, partial repayments, reminders, search, or pagination.
- No CI pipeline and no mobile automated tests.
- The repository's mobile `android/` folder is generated and checked in; `expo prebuild` can overwrite manual native changes.

---

## Demo script

A quick 2–3 minute walkthrough:

1. Start the API and Expo. Show the empty Loans screen or seeded data.
2. Log in with `+919999999999`, request an OTP, read it from the server log, and verify.
3. Show the summary card and existing loans.
4. Add a loan with a receipt photo.
5. Add a loan with a past due date and point out the red overdue styling and overdue summary amount.
6. Try an invalid amount to show inline validation.
7. Mark a loan as repaid and show the updated badges and totals.
8. Pull to refresh, log out, and reopen the app to show that the session was persisted before logout.

---

## Further reading

- [`EXPLAINER.md`](./EXPLAINER.md) — file-by-file walkthrough and likely interview questions.
- `backend/tests/` — executable documentation of the API's behavior and edge cases.
