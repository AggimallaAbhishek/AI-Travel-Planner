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
  const rootVercelConfig = JSON.parse(
    fs.readFileSync(rootVercelConfigPath, "utf8")
  );

  assert.equal(fs.existsSync(rootVercelConfigPath), true);
  assert.equal(fs.existsSync(rootApiHandlerPath), true);
  assert.equal(fs.existsSync(legacyNestedVercelConfigPath), false);
  assert.equal(
    rootVercelConfig.installCommand,
    'npm install --prefix "Travel Planner"'
  );
  assert.equal(
    rootVercelConfig.buildCommand,
    'npm run build --prefix "Travel Planner"'
  );
  assert.equal(rootVercelConfig.outputDirectory, "Travel Planner/dist");
  assert.deepEqual(rootVercelConfig.rewrites, [
    { source: "/api", destination: "/api/[...all]" },
    { source: "/api/:path*", destination: "/api/[...all]" },
    { source: "/(.*)", destination: "/index.html" },
  ]);
  assert.equal("routes" in rootVercelConfig, false);
});

test(".env.example keeps production API base URL blank for same-origin deploys", () => {
  const envExamplePath = path.join(appRoot, ".env.example");
  const envExample = fs.readFileSync(envExamplePath, "utf8");

  assert.match(envExample, /^VITE_API_BASE_URL=$/m);
  assert.doesNotMatch(envExample, /^VITE_API_BASE_URL=http:\/\/localhost:3001$/m);
});

test("package.json declares the Vercel-safe Node 22 runtime", () => {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

  assert.equal(packageJson.engines?.node, "22.x");
});
