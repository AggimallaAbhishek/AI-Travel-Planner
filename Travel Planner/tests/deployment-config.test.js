import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");

test("deployment config keeps a single root Vercel configuration", () => {
  const rootVercelConfigPath = path.join(repoRoot, "vercel.json");
  const legacyNestedVercelConfigPath = path.join(appRoot, "vercel.json");
  const rootApiHandlerPath = path.join(repoRoot, "api", "[...all].js");

  assert.equal(fs.existsSync(rootVercelConfigPath), true);
  assert.equal(fs.existsSync(rootApiHandlerPath), true);
  assert.equal(fs.existsSync(legacyNestedVercelConfigPath), false);
});

test(".env.example keeps production API base URL blank for same-origin deploys", () => {
  const envExamplePath = path.join(appRoot, ".env.example");
  const envExample = fs.readFileSync(envExamplePath, "utf8");

  assert.match(envExample, /^VITE_API_BASE_URL=$/m);
  assert.doesNotMatch(envExample, /^VITE_API_BASE_URL=http:\/\/localhost:3001$/m);
});
