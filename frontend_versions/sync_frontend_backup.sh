#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/Travel Planner"
BACKUP_DIR="$ROOT_DIR/frontend_versions"
CHANGES_FILE="$BACKUP_DIR/changes.md"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: source project not found at '$SOURCE_DIR'."
  exit 1
fi

mkdir -p "$BACKUP_DIR/shared"

rsync -a --delete "$SOURCE_DIR/src/" "$BACKUP_DIR/src/"
rsync -a --delete "$SOURCE_DIR/public/" "$BACKUP_DIR/public/"
rsync -a --delete "$SOURCE_DIR/shared/trips.js" "$BACKUP_DIR/shared/trips.js"
rsync -a --delete "$SOURCE_DIR/shared/tripPrefill.js" "$BACKUP_DIR/shared/tripPrefill.js"

cp "$SOURCE_DIR/index.html" "$BACKUP_DIR/index.html"
cp "$SOURCE_DIR/vite.config.js" "$BACKUP_DIR/vite.config.js"
cp "$SOURCE_DIR/tailwind.config.js" "$BACKUP_DIR/tailwind.config.js"
cp "$SOURCE_DIR/postcss.config.js" "$BACKUP_DIR/postcss.config.js"
cp "$SOURCE_DIR/jsconfig.json" "$BACKUP_DIR/jsconfig.json"
cp "$SOURCE_DIR/components.json" "$BACKUP_DIR/components.json"
cp "$SOURCE_DIR/eslint.config.js" "$BACKUP_DIR/eslint.config.js"

PHASE_TITLE="${1:-Phase Update - Frontend Sync}"
DESCRIPTION="${2:-Synchronized frontend backup with current main frontend files.}"
FILES_AFFECTED="${3:-src/, public/, shared/trips.js, shared/tripPrefill.js, index.html, vite.config.js, tailwind.config.js, postcss.config.js, jsconfig.json, components.json, eslint.config.js}"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M')"

if [[ ! -f "$CHANGES_FILE" ]]; then
  cat > "$CHANGES_FILE" <<'EOF'
## Phase 1 - Initial Setup
- Created frontend backup baseline.

Timestamp: 1970-01-01 00:00

---
EOF
fi

cat >> "$CHANGES_FILE" <<EOF

## ${PHASE_TITLE}
- ${DESCRIPTION}
- Files affected: ${FILES_AFFECTED}

Timestamp: ${TIMESTAMP}

---
EOF

echo "Frontend backup sync complete."
echo "Updated: $BACKUP_DIR"
echo "Change log appended: $CHANGES_FILE"
