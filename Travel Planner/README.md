# Travel Planner App

Travel Planner is a Vite + React single-page application backed by a small Express API. It uses Firebase Authentication for Google sign-in, Cloud Firestore for saved trips, and Google Gemini for itinerary generation.

## Implemented Product Surface

- Landing page with hero, destinations, world map, and recommendation sections
- Guided trip creation flow at `/create-trip`
- Google sign-in flow via Firebase Auth
- Authenticated trip generation through `/api/trips/generate`
- Saved trips page at `/my-trips`
- Trip detail page at `/trips/:tripId`
- Static informational pages such as About, Features, Help Center, Travel Guides, AI Tips, Blog, and API Docs
- Global dark/light theming and shared Voyagr design system
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
- Gemini service wrapper for itinerary generation
- Request validation, auth guards, CORS, and in-memory rate limiting

### Storage And Identity

- Firebase Authentication for user sign-in
- Cloud Firestore for persisted trips
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
- `POST /api/trips/generate`
- `GET /api/trips/:tripId`
- `GET /api/trips/:tripId/recommendations`
- `GET /api/my-trips`

## Project Structure

```text
Travel Planner/
├── public/                     # Static assets
├── server/                     # Express API
│   ├── lib/                    # Firebase Admin helpers
│   ├── middleware/             # Auth, CORS, rate limit
│   ├── routes/                 # API route handlers
│   └── services/               # Gemini and trip services
├── shared/                     # Shared trip normalization / validation
├── scripts/                    # Frontend backup sync scripts
├── src/
│   ├── components/             # Reusable UI and Voyagr homepage modules
│   ├── constants/              # Planner options and static config
│   ├── context/                # Auth and theme providers
│   ├── create-trip/            # Trip creation page
│   ├── lib/                    # API, images, map, theme, autocomplete helpers
│   ├── my-trips/               # Saved trips page
│   ├── pages/                  # Static pages and login
│   ├── service/                # Firebase client config
│   ├── styles/                 # Voyagr stylesheets
│   └── view-trip/              # Trip detail page
├── tests/                      # Node test runner suites
├── .env.example
├── package.json
└── vite.config.js
```

## Local Development

### Prerequisites

- Node.js 18+
- npm
- Firebase project with:
  - Authentication -> Google provider enabled
  - Cloud Firestore created in Native mode
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

FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
TRIP_GENERATION_RATE_LIMIT_WINDOW_MS=60000
TRIP_GENERATION_RATE_LIMIT_MAX=5
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
npm run audit:full          # Full npm audit
npm run audit:prod          # Production dependency audit
```

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

- Trip generation depends on external Gemini availability
- Firestore and Firebase Auth must be configured correctly for the full flow
- The frontend backup mirror is operationally useful but not part of runtime behavior
- Some static pages are informational and do not connect to backend data
