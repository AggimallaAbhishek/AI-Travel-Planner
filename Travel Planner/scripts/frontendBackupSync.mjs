import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFilePath), "..");
const repoRoot = path.resolve(projectRoot, "..");
const sourceRoot = projectRoot;
const backupRoot = path.join(repoRoot, "frontend_versions");
const changeLogPath = path.join(backupRoot, "changes.md");
const manifestPath = path.join(backupRoot, "duplicated_files_manifest.txt");

const TRACKED_DIRECTORIES = Object.freeze(["src", "public"]);
const TRACKED_FILES = Object.freeze([
  "shared/trips.js",
  "shared/tripPrefill.js",
  "index.html",
  "vite.config.js",
  "tailwind.config.js",
  "postcss.config.js",
  "jsconfig.json",
  "components.json",
  "eslint.config.js",
]);
const IGNORED_PREFIXES = Object.freeze([
  ".git/",
  "node_modules/",
  "dist/",
  "server/",
  "tests/",
  "frontend_versions/",
]);

export function normalizeRelativePath(inputPath = "") {
  return String(inputPath).replaceAll("\\", "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/");
}

export function isTrackedFrontendPath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (!normalizedPath) {
    return false;
  }

  if (IGNORED_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) {
    return false;
  }

  if (TRACKED_FILES.includes(normalizedPath)) {
    return true;
  }

  return TRACKED_DIRECTORIES.some(
    (trackedDirectory) =>
      normalizedPath === trackedDirectory || normalizedPath.startsWith(`${trackedDirectory}/`)
  );
}

export function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function createChangeLogEntry({ phaseTitle, description, files, timestamp = formatTimestamp() }) {
  const formattedFiles = files?.length ? files.map((filePath) => `\`${filePath}\``).join(", ") : "n/a";

  return `
## ${phaseTitle}
- ${description}
- Files affected: ${formattedFiles}

Timestamp: ${timestamp}

---
`;
}

function logDebug(message, context = undefined) {
  if (context) {
    console.info("[frontend-sync]", message, context);
    return;
  }

  console.info("[frontend-sync]", message);
}

function ensureParentDirectory(absoluteFilePath) {
  mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
}

function resolveSourcePath(relativePath) {
  return path.join(sourceRoot, relativePath);
}

function resolveBackupPath(relativePath) {
  return path.join(backupRoot, relativePath);
}

function syncSinglePath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);

  if (!isTrackedFrontendPath(normalizedPath)) {
    return false;
  }

  const sourcePath = resolveSourcePath(normalizedPath);
  const backupPath = resolveBackupPath(normalizedPath);

  if (!existsSync(sourcePath)) {
    rmSync(backupPath, { recursive: true, force: true });
    logDebug("Removed backup path for deleted source file", { path: normalizedPath });
    return true;
  }

  const sourceStats = statSync(sourcePath);

  if (sourceStats.isDirectory()) {
    rmSync(backupPath, { recursive: true, force: true });
    cpSync(sourcePath, backupPath, { recursive: true, force: true });
    logDebug("Mirrored tracked directory", { path: normalizedPath });
    return true;
  }

  ensureParentDirectory(backupPath);
  cpSync(sourcePath, backupPath, { force: true });
  logDebug("Mirrored tracked file", { path: normalizedPath });
  return true;
}

function resetTrackedRoots() {
  for (const trackedDirectory of TRACKED_DIRECTORIES) {
    const backupDirectoryPath = resolveBackupPath(trackedDirectory);
    rmSync(backupDirectoryPath, { recursive: true, force: true });
    syncSinglePath(trackedDirectory);
  }

  for (const trackedFile of TRACKED_FILES) {
    syncSinglePath(trackedFile);
  }
}

function collectSourceDirectoryFiles(relativeDirectoryPath) {
  const sourceDirectoryPath = resolveSourcePath(relativeDirectoryPath);

  if (!existsSync(sourceDirectoryPath)) {
    return [];
  }

  return walkFiles(sourceDirectoryPath).map((relativePathWithinDirectory) =>
    normalizeRelativePath(path.join(relativeDirectoryPath, relativePathWithinDirectory))
  );
}

function getFileFingerprint(absoluteFilePath) {
  const fileStats = statSync(absoluteFilePath);
  return `${Math.trunc(fileStats.mtimeMs)}:${fileStats.size}`;
}

function buildSourceSnapshot() {
  const snapshot = new Map();

  for (const trackedDirectory of TRACKED_DIRECTORIES) {
    for (const relativeFilePath of collectSourceDirectoryFiles(trackedDirectory)) {
      const sourceFilePath = resolveSourcePath(relativeFilePath);
      snapshot.set(relativeFilePath, getFileFingerprint(sourceFilePath));
    }
  }

  for (const trackedFile of TRACKED_FILES) {
    const sourceFilePath = resolveSourcePath(trackedFile);

    if (!existsSync(sourceFilePath)) {
      continue;
    }

    snapshot.set(trackedFile, getFileFingerprint(sourceFilePath));
  }

  return snapshot;
}

function getChangedSnapshotPaths(previousSnapshot, currentSnapshot) {
  const allPaths = new Set([...previousSnapshot.keys(), ...currentSnapshot.keys()]);
  const changedPaths = [];

  for (const relativePath of allPaths) {
    const previousValue = previousSnapshot.get(relativePath);
    const currentValue = currentSnapshot.get(relativePath);

    if (previousValue !== currentValue) {
      changedPaths.push(relativePath);
    }
  }

  return changedPaths.sort((firstPath, secondPath) => firstPath.localeCompare(secondPath));
}

function walkFiles(directoryPath, basePath = directoryPath) {
  if (!existsSync(directoryPath)) {
    return [];
  }

  const entries = readdirSync(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absoluteEntryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(absoluteEntryPath, basePath));
      continue;
    }

    const relativeToBase = normalizeRelativePath(path.relative(basePath, absoluteEntryPath));
    files.push(relativeToBase);
  }

  return files;
}

function refreshBackupManifest() {
  const filePaths = walkFiles(backupRoot)
    .filter((filePath) => filePath !== "duplicated_files_manifest.txt")
    .sort((firstPath, secondPath) => firstPath.localeCompare(secondPath));

  const fileContents = filePaths.map((filePath) => `frontend_versions/${filePath}`).join("\n");
  ensureParentDirectory(manifestPath);
  writeFileSync(manifestPath, `${fileContents}\n`, { encoding: "utf8" });
  logDebug("Refreshed backup manifest", { fileCount: filePaths.length });
}

function ensureChangeLogFile() {
  if (existsSync(changeLogPath)) {
    return;
  }

  const bootstrapEntry = createChangeLogEntry({
    phaseTitle: "Phase 1 - Initial Setup",
    description: "Created frontend backup baseline.",
    files: ["src/", "public/"],
    timestamp: "1970-01-01 00:00",
  });
  ensureParentDirectory(changeLogPath);
  appendFileSync(changeLogPath, bootstrapEntry, { encoding: "utf8" });
}

function appendChangeLog({ phaseTitle, description, files }) {
  ensureChangeLogFile();
  const entry = createChangeLogEntry({
    phaseTitle,
    description,
    files,
    timestamp: formatTimestamp(),
  });
  appendFileSync(changeLogPath, entry, { encoding: "utf8" });
  logDebug("Appended frontend backup change-log entry", {
    phaseTitle,
    fileCount: files.length,
  });
}

function runFullSync({ shouldLogEntry = true, phaseTitle = "Phase Update - Frontend Snapshot" } = {}) {
  resetTrackedRoots();
  refreshBackupManifest();

  if (shouldLogEntry) {
    appendChangeLog({
      phaseTitle,
      description: "Synchronized frontend backup with current tracked frontend files.",
      files: [...TRACKED_DIRECTORIES, ...TRACKED_FILES],
    });
  }
}

function startWatchMode() {
  let previousSnapshot = buildSourceSnapshot();
  const pollIntervalMs = 1200;
  const intervalHandle = setInterval(() => {
    try {
      const currentSnapshot = buildSourceSnapshot();
      const changedPaths = getChangedSnapshotPaths(previousSnapshot, currentSnapshot);

      if (changedPaths.length === 0) {
        return;
      }

      const mirroredPaths = changedPaths.filter((relativePath) => syncSinglePath(relativePath));

      if (mirroredPaths.length > 0) {
        refreshBackupManifest();
        appendChangeLog({
          phaseTitle: "Phase Update - Auto Sync",
          description: "Automatically mirrored tracked frontend edits into frontend_versions.",
          files: mirroredPaths,
        });
      }

      previousSnapshot = currentSnapshot;
    } catch (error) {
      logDebug("Polling sync iteration failed", {
        message: error.message,
      });
    }
  }, pollIntervalMs);

  logDebug("Watching tracked frontend files for live backup sync (polling mode)", {
    sourceRoot,
    backupRoot,
    pollIntervalMs,
    trackedFileCount: previousSnapshot.size,
  });

  function closeWatcher(signalName) {
    logDebug("Stopping frontend backup watcher", { signal: signalName });
    clearInterval(intervalHandle);

    process.exit(0);
  }

  process.on("SIGINT", () => closeWatcher("SIGINT"));
  process.on("SIGTERM", () => closeWatcher("SIGTERM"));
}

function parseArguments() {
  const args = new Set(process.argv.slice(2));
  return {
    watchMode: args.has("--watch"),
    skipInitialLog: args.has("--skip-initial-log"),
    runOnce: args.has("--full") || args.size === 0,
  };
}

function main() {
  const { watchMode, skipInitialLog, runOnce } = parseArguments();
  const shouldRunFullSync = runOnce || watchMode;

  if (shouldRunFullSync) {
    runFullSync({ shouldLogEntry: !skipInitialLog });
  }

  if (!watchMode) {
    logDebug("Completed frontend backup synchronization.");
    return;
  }

  startWatchMode();
}

if (path.resolve(process.argv[1] ?? "") === scriptFilePath) {
  main();
}
