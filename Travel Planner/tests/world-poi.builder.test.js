import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildWorldPoiArtifacts,
  DEFAULT_WORLD_POI_OUT_DIR,
  summarizeWorldPoiArtifacts,
  verifyWorldPoiArtifacts,
} from "../scripts/buildWorldPoiIndex.mjs";

test("world poi builder emits valid shard artifacts", async () => {
  const outDir = await mkdtemp(path.join(os.tmpdir(), "world-poi-builder-"));

  try {
    const buildSummary = await buildWorldPoiArtifacts({ outDir });
    const verifySummary = await verifyWorldPoiArtifacts({ outDir });
    const manifest = JSON.parse(
      await readFile(path.join(outDir, "manifest.json"), "utf8")
    );

    assert.equal(buildSummary.totalItemCount >= 50, true);
    assert.equal(verifySummary.ok, true);
    assert.equal(manifest.shardCount >= 10, true);
    assert.equal(Array.isArray(manifest.shardMap), true);
    assert.equal(manifest.shardMap.every((shard) => shard.file.endsWith(".json.gz")), true);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("committed world poi artifacts stay within size budget and remain consistent", async () => {
  const summary = await summarizeWorldPoiArtifacts({
    outDir: DEFAULT_WORLD_POI_OUT_DIR,
  });
  const verification = await verifyWorldPoiArtifacts({
    outDir: DEFAULT_WORLD_POI_OUT_DIR,
    sizeBudgetBytes: 250_000,
  });

  assert.equal(summary.totalItemCount >= 50, true);
  assert.equal(summary.destinationCount >= 10, true);
  assert.equal(verification.ok, true);
  assert.equal(summary.sizeBytes < 250_000, true);
});
