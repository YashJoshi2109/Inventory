# SEAR Lab Inventory — Frontend

React 18 + TypeScript single-page app (Vite, Tailwind, Framer Motion) for the SEAR Lab
Inventory system. Mobile-first, installable as a PWA, and able to keep taking stock
movements while the network is down.

The backend it talks to is documented in [`../backend/README.md`](../backend/README.md);
the product overview, feature list, and deployment notes are in the root
[`README.md`](../README.md).

## Layout

```
src/
  main.tsx          Entry; mounts <App/>
  App.tsx           QueryClient, router, ProtectedRoute, React.lazy page splitting
  api/              One axios instance (client.ts) + one module per backend resource
  store/            Zustand stores, persisted to localStorage: auth, sandbox, theme
  hooks/            useScanner (ZXing camera decode), useOffline, useHaptic, useDebounce
  offline/          Dexie (IndexedDB) schema and the offline write queue
  pages/            One file per route, all lazy-loaded
  components/
    layout/         Shell: Sidebar, TopBar, MobileNav, ProfessorCard
    scanner/        BarcodeScanner (camera viewfinder around useScanner)
    ui/             Button, Card, Modal, Badge, Skeleton, charts and gauges
    charts/ visualization/
  types/            Shared API types
  utils/            apiError, animations, fileActions
```

`@/` resolves to `src/` (see `tsconfig.json` and `vite.config.ts`).

## State: Zustand vs React Query

Two kinds of state, deliberately kept apart:

| Kind | Lives in | Examples |
|------|----------|----------|
| Client/session state the app owns | Zustand (`src/store/`), persisted to localStorage | current user and JWT pair (`auth.ts`), sandbox toggle (`sandbox.ts`), light/dark theme (`theme.ts`) |
| Server state the backend owns | React Query | items, locations, transactions, dashboard, energy readings |

React Query is configured in `App.tsx` with a 30 s `staleTime` and a retry policy that
gives up immediately on 401/403/404 and otherwise retries once. Pages never cache server
data in Zustand; if a value comes from the API it goes through a query hook so refetching,
invalidation, and loading states stay uniform.

## API client

`src/api/client.ts` is the single axios instance every API module uses:

- **Base URL** defaults to same-origin `/api/v1`. On Vercel a rewrite forwards that path
  to the backend, which avoids CORS and keeps the SPA catch-all out of API traffic.
  `VITE_API_URL` overrides it for local development against a different host.
- **Request interceptor** attaches the bearer token from the auth store and, when sandbox
  mode is on, the `X-Sandbox-Mode: true` header. The backend uses that header to re-scope
  every read and write to the user's isolated sandbox data set.
- **Response interceptor** handles 401 with a single-flight refresh: parallel 401s share
  one `/auth/refresh` call and the failed request is retried once. The session is cleared
  only when the server rejects the refresh token, not on a network error or a 502 from a
  cold backend.
- **Offline queue** — a POST/PATCH/DELETE that fails with no response at all is handed to
  `offlineQueue` for replay (see below).

## Scan flow

Scanning is the core workflow and lives in `src/pages/Scan.tsx`, built on two smaller
state machines:

1. **Decoder** — `useScanner` wraps ZXing's `BrowserMultiFormatReader` and exposes
   `ScannerState = idle | starting | scanning | error | stopped`. It restricts decoding
   to QR, Code 128, EAN-13/8 and UPC-A/E, prefers the rear camera, and ignores a repeat of
   the same value for 1.5 s so one physical scan does not fire twice.
2. **Workflow** — the page picks a `ScanMode` (`add`, `remove`, `transfer`, `modify`)
   and each mode walks an explicit step enum. Stock-in uses
   `AddStep = select-subtype → scan-item → scan-rack → confirm` (with `fill-details` for
   a brand-new item and `lookup-scan → lookup-result` for read-only lookup); stock-out
   uses `RemoveStep = scan-item → select-location → confirm`. Every transition goes through
   one setter that also reports the phase upward, so the header and haptics stay in sync.

Unrecognised codes fall through to an "add item" path rather than a dead end. Heavy
panels are lazy-loaded with `Suspense` so the camera starts before the rest of the page
has downloaded.

## Offline support

Three layers cooperate so a technician can keep scanning without signal:

- **Service worker** (`vite-plugin-pwa`, Workbox) precaches the app shell and applies
  `NetworkFirst` caching to item, location and dashboard reads with a 3 s network
  timeout, and `CacheFirst` to barcode images. API and upload navigations are excluded
  from the SPA fallback.
- **IndexedDB** (`src/offline/db.ts`, Dexie) holds the `offlineQueue` table plus cached
  item and location lookups for scanning while disconnected.
- **Queue drain** — `useOffline` listens to the window `online`/`offline` events, shows
  the pending count, and replays queued mutations in order when connectivity returns
  (`drainOfflineQueue`). `syncNow` does the same on demand and refuses to run twice at
  once or while offline.

## Run locally

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173; /api is proxied to http://localhost:8000
```

Set `VITE_API_URL` in `frontend/.env` when the backend is not on the default proxy path.
See the root `README.md` for the full environment-variable reference.

## Checks

```bash
npm run lint           # eslint, zero warnings allowed
node_modules/.bin/tsc --noEmit
npm run build          # tsc -b && vite build → dist/
```

### Smoke tests against a deployment

`e2e/smoke/` holds two Playwright specs: `api.spec.ts` hits the REST API directly and
`browser.spec.ts` signs in through the real UI.

```bash
npm run smoketest:install        # once: downloads Chromium
SMOKE_LOGIN_USERNAME=... SMOKE_LOGIN_PASSWORD=... npm run smoketest
```

`SMOKE_LOGIN_PASSWORD` is required; the specs refuse to start without it so no
credential is ever committed as a default. `PLAYWRIGHT_BASE_URL` and
`PLAYWRIGHT_API_URL` point the suite at a different frontend or backend.

## Deployment

Deployed to Vercel from the `frontend/` directory (framework Vite, output `dist`). The
only build-time setting is `VITE_API_URL`; the rewrite of `/api/v1` to the backend is
what lets the app ship with a same-origin API path.
