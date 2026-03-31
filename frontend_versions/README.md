# Frontend Backup System

This directory is an isolated duplicate of frontend files from:

`/Users/aggimallaabhishek/Documents/Travel-Plannar/Travel Planner`

It is not imported by the runtime app and is only used for backup/version tracking.

## Included Frontend Scope

- `src/`
- `public/`
- `shared/trips.js`
- `shared/tripPrefill.js`
- `index.html`
- `vite.config.js`
- `tailwind.config.js`
- `postcss.config.js`
- `jsconfig.json`
- `components.json`
- `eslint.config.js`

## Sync Process

### Recommended (Automatic While Developing)

From project folder:

`/Users/aggimallaabhishek/Documents/Travel-Plannar/Travel Planner`

run:

```bash
npm run dev
```

This now starts:

1. Vite dev server
2. Frontend backup watcher (`scripts/frontendBackupSync.mjs --watch`)

Every tracked frontend file create/update/delete is mirrored automatically into `frontend_versions/`.

### Manual Full Sync

From project folder:

```bash
npm run sync:frontend
```

### Watch-Only Mode (Without Vite)

From project folder:

```bash
npm run sync:frontend:watch
```

### Legacy Shell Sync Script

Run:

```bash
/Users/aggimallaabhishek/Documents/Travel-Plannar/frontend_versions/sync_frontend_backup.sh "Phase N - Title" "What changed" "Files affected"
```

Example:

```bash
/Users/aggimallaabhishek/Documents/Travel-Plannar/frontend_versions/sync_frontend_backup.sh "Phase 4 - Navbar polish" "Aligned theme toggle and auth buttons." "src/components/custom/Header.jsx, src/styles/voyagr.css"
```

This command:

1. Re-syncs frontend files into this folder.
2. Appends a new entry into `changes.md` with timestamp.

## Safety Rule

Do not import modules from `frontend_versions/` in application code.
