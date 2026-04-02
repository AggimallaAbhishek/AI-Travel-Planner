# Travel Planner App

Travel Planner is a Vite + React single-page application backed by an Express API. It combines Firebase Authentication + Firestore compatibility with a hybrid structured planning pipeline (PostgreSQL/PostGIS + Python route optimization + optional Gemini narrative enrichment).

## Implemented Product Surface

- Landing page with hero, destinations, world map, and recommendation sections
- Guided trip creation flow at `/create-trip`
- Google sign-in flow via Firebase Auth
- Authenticated trip generation through `/api/trips/generate`
- Saved trips page at `/my-trips`
- Trip detail page at `/trips/:tripId`
- Static informational pages such as About, Features, Help Center, Travel Guides, AI Tips, Blog, and API Docs
- Global dark/light theming and shared AI TRAVEL PLANNER design system
- Frontend snapshot sync into `../frontend_versions/`

## Architecture

### Frontend

- React 18 with React Router
- Vite build system
- Tailwind CSS plus app-specific `voyagr` styles
- Firebase client SDK for auth state
- Toast-based UX feedback and route-level state handling

### Backend

- Express 5 API under [`server/`](/Users/aggimallaabhishek/Documents/Travel-Plannar/Travel%20Planner/server)
- Firebase Admin SDK for token verification and Firestore access
- Data ingestion pipeline for destination POIs (hotels, restaurants, attractions)
- Python optimizer bridge for shortest path + TSP heuristic + clustering
- Optional Gemini narrative enrichment (descriptions/tips only, not core routing logic)
- Request validation, auth guards, CORS, trace IDs, and endpoint-specific rate limiting

### Storage And Identity

- Firebase Authentication for user sign-in
- Cloud Firestore for persisted trip projection (frontend compatibility)
- PostgreSQL/PostGIS for normalized destinations, places, transport edges, and optimization runs
- Owner-based access checks for trip read/list endpoints

## Routes

### Frontend Routes

- `/`
- `/login`
- `/create-trip`
- `/my-trips`
- `/trips/:tripId`
- `/about`
- `/contact`
- `/features`
- `/our-story`
- `/team`
- `/careers`
- `/privacy-policy`
- `/help-center`
- `/faqs`
- `/feedback`
- `/travel-guides`
- `/ai-tips`
- `/blog`
- `/api-docs`

### Backend Routes

- `GET /api/health`
- `GET /api/auth/session`
- `GET /api/places/autocomplete`
- `POST /api/trips/generate`
- `GET /api/trips/:tripId`
- `GET /api/trips/:tripId/recommendations`
- `GET /api/trips/:tripId/routes?day=1`
- `GET /api/my-trips`

## Project Structure

```text
Travel Planner/
├── public/                     # Static assets
├── server/                     # Express API
│   ├── lib/                    # Firebase Admin helpers
│   ├── data/                   # Hybrid SQL + in-memory store adapters
│   ├── middleware/             # Auth, CORS, rate limit
│   ├── routes/                 # API route handlers
│   └── services/               # Ingestion, planning, optimization, recommendations
├── shared/                     # Shared trip normalization / validation
├── scripts/                    # Frontend backup sync scripts
├── src/
│   ├── components/             # Reusable UI and AI TRAVEL PLANNER homepage modules
│   ├── constants/              # Planner options and static config
│   ├── context/                # Auth and theme providers
│   ├── create-trip/            # Trip creation page
│   ├── lib/                    # API, images, map, theme, autocomplete helpers
│   ├── my-trips/               # Saved trips page
│   ├── pages/                  # Static pages and login
│   ├── service/                # Firebase client config
│   ├── styles/                 # AI TRAVEL PLANNER stylesheets
│   └── view-trip/              # Trip detail page
├── tests/                      # Node test runner suites
├── .env.example
├── package.json
└── vite.config.js

route_optimizer.py              # Python Dijkstra + TSP + clustering engine
```

## Local Development

### Prerequisites

- Node.js 18+
- npm
- Firebase project with:
  - Authentication -> Google provider enabled
  - Cloud Firestore created in Native mode
- PostgreSQL (PostGIS recommended) for structured planning storage
- Gemini API key with model access

### Install

```bash
npm install
```

### Environment

Copy the template:

```bash
cp .env.example .env
```

Required values:

```env
VITE_API_BASE_URL=
VITE_DEV_API_PROXY=http://localhost:3001

VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

GOOGLE_GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GOOGLE_PLACES_API_KEY=
RECOMMENDATIONS_PROVIDER_TIMEOUT_MS=8000
RECOMMENDATIONS_CACHE_TTL_MS=300000
RECOMMENDATIONS_MOCK_CACHE_TTL_MS=30000
RECOMMENDATIONS_UNAVAILABLE_CACHE_TTL_MS=30000
RECOMMENDATIONS_NEARBY_RADIUS_METERS=12000
RECOMMENDATIONS_CACHE_MAX_ENTRIES=200
DESTINATION_DATA_BUNDLE_CACHE_MAX_ENTRIES=100
DESTINATION_AUTOCOMPLETE_CACHE_MAX_ENTRIES=500
DESTINATION_FRESHNESS_TTL_MS=86400000

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

SQL_ENABLE=true
SQL_DATABASE_URL=
SQL_MAX_POOL_SIZE=10
SQL_IDLE_TIMEOUT_MS=30000
SQL_CONNECT_TIMEOUT_MS=10000
SQL_SSL_MODE=disable
SQL_STRICT_MODE=false

ROUTE_CANDIDATE_LIMIT=24
PYTHON_BIN=python3
PYTHON_ROUTE_OPTIMIZER_PATH=
PYTHON_OPTIMIZER_TIMEOUT_MS=10000
PLANNING_USE_GEMINI_NARRATIVE=true

UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
ADMIN_EMAILS=
TRIP_GENERATION_RATE_LIMIT_WINDOW_MS=60000
TRIP_GENERATION_RATE_LIMIT_MAX=5
PLACES_AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS=60000
PLACES_AUTOCOMPLETE_RATE_LIMIT_MAX=30
RECOMMENDATIONS_RATE_LIMIT_WINDOW_MS=60000
RECOMMENDATIONS_RATE_LIMIT_MAX=30
ROUTE_OPTIMIZATION_RATE_LIMIT_WINDOW_MS=60000
ROUTE_OPTIMIZATION_RATE_LIMIT_MAX=30
OUTBOUND_ALLOWED_HOSTS=maps.googleapis.com,generativelanguage.googleapis.com,api.upstash.com
PORT=3001
```

### Firebase Setup Notes

- `VITE_FIREBASE_*` values come from the Firebase **Web App** config
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` come from a Firebase **service account** JSON
- `FIREBASE_PRIVATE_KEY` must keep escaped newlines:

```env
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

- Trips are stored in **Cloud Firestore**, not Realtime Database
- Firestore must exist in the same Firebase project referenced by `FIREBASE_PROJECT_ID`

## Scripts

```bash
npm run dev                 # Vite dev server + frontend backup sync
npm run dev:vite            # Vite only
npm run dev:server          # Express server with watch mode
npm run server              # Express server
npm run build               # Production build
npm run preview             # Preview built frontend
npm run lint                # ESLint
npm test                    # Node test runner
npm run sync:frontend       # One-time mirror into ../frontend_versions
npm run sync:frontend:watch # Watch-only frontend mirror
npm run verify:trip-pdf-ui  # Browser automation check for /trips/:tripId PDF actions
npm run audit:full          # Full npm audit
npm run audit:prod          # Production dependency audit
```

### Trip PDF UI Verification

The automated verifier checks that `Download PDF` and `Print` actions are present and clickable on the trip detail header.

Prerequisites:

1. Start backend and frontend dev servers
2. Sign in with Google in the local app
3. Open a valid authenticated trip URL at `/trips/:tripId`

Run:

```bash
TRIP_VERIFY_URL=http://127.0.0.1:4174/trips/<tripId> npm run verify:trip-pdf-ui
```

Output artifacts:

- Screenshot: `/tmp/trip-pdf-ui-verify.png`
- Structured logs prefixed with `[trip-pdf:verify]`

If the script exits with code `2`, it detected an auth gate and could not reach trip actions.

## Frontend Backup Mirror

Frontend snapshots are maintained in:

[`../frontend_versions/`](/Users/aggimallaabhishek/Documents/Travel-Plannar/frontend_versions)

`npm run dev` automatically starts the polling-based backup sync process.  
Manual sync is available through `npm run sync:frontend`.

## Testing

The project uses the Node test runner and includes coverage for:

- Shared trip normalization and validation
- Theme behavior
- Route/auth helper logic
- Rate limiting
- World map projection helpers
- Frontend backup sync utilities
- Backend trip error classification

Run:

```bash
npm test
```

## Autocomplete Protection

- `GET /api/places/autocomplete` stays public for guest trip planning, but it is rate-limited with `PLACES_AUTOCOMPLETE_RATE_LIMIT_WINDOW_MS` and `PLACES_AUTOCOMPLETE_RATE_LIMIT_MAX`.
- Authenticated admin requests bypass endpoint throttles with `X-RateLimit-Bypass: admin`; guest/public traffic remains rate-limited.
- Server-side destination caches are bounded with LRU-style TTL eviction. Tune capacity with `RECOMMENDATIONS_CACHE_MAX_ENTRIES`, `DESTINATION_DATA_BUNDLE_CACHE_MAX_ENTRIES`, and `DESTINATION_AUTOCOMPLETE_CACHE_MAX_ENTRIES`.
- Hotel and restaurant recommendations use Google Places Text Search first, then Nearby Search fallback for missing categories. Tune this fallback radius with `RECOMMENDATIONS_NEARBY_RADIUS_METERS`.
- `verified_unavailable` recommendation payloads use a short cache TTL (`RECOMMENDATIONS_UNAVAILABLE_CACHE_TTL_MS`) so live recommendations recover quickly after configuration or provider outages.

## Admin RBAC

- Backend role resolution is email-allowlist based, case-insensitive, and always includes required fallback admin email: `aggimallaabhishek@gmail.com`.
- Optional `ADMIN_EMAILS` can include additional comma-separated admin addresses.
- `GET /api/auth/session` returns normalized `user`, `role`, and capability flags for frontend gating.
- Admin-only capabilities include:
  - rate-limit bypass on authenticated endpoints
  - cross-user trip read/list access on existing trip APIs
  - debug UI visibility and force-refresh controls in frontend diagnostics panels

## Troubleshooting

### `HTTP 500` while generating a trip

Check the backend terminal logs first.

Common causes:

- Firestore has not been created
- `FIREBASE_PROJECT_ID` points at the wrong Firebase project
- Service-account credentials do not belong to the same Firebase project
- Gemini API key is invalid, rate-limited, or lacks model access
- Backend server is not running

### `5 NOT_FOUND` while saving trips

This usually means the default Firestore database is missing or the backend is pointed at the wrong Firebase project.

Fix path:

1. Firebase Console -> `Build` -> `Firestore Database`
2. Create the default Firestore database in Native mode if it does not exist
3. Confirm `.env` service-account variables target that same Firebase project
4. Restart the backend

### `Firebase Auth is not configured`

One or more `VITE_FIREBASE_*` variables are missing or invalid.

### `Unable to reach the API server`

Start the backend:

```bash
npm run server
```

## Current Constraints

- Structured planning quality depends on Google Places availability and destination freshness windows
- PostgreSQL/PostGIS is recommended for full relational + geospatial performance (in-memory fallback exists for local/dev)
- Python runtime (`python3`) must be available for the optimizer bridge (Node fallback heuristic is used when unavailable)
- Firestore and Firebase Auth must be configured correctly for ownership-protected trip reads
- The frontend backup mirror is operationally useful but not part of runtime behavior
- Some static pages are informational and do not connect to backend data
