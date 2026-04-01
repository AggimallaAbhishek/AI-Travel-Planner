import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const optimizerScriptPath = path.join(projectRoot, "route_optimizer.py");

async function runPythonOptimizer(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [optimizerScriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `python3 exited with code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

test("route_optimizer.py returns an optimized visit order, shortest paths, and mst", async () => {
  const result = await runPythonOptimizer({
    matrix: [
      [0, 5, 2, null],
      [5, 0, 1, 8],
      [2, 1, 0, 3],
      [null, 8, 3, 0],
    ],
    originIndex: 0,
    destinationIndex: null,
  });

  assert.equal(result.algorithm, "python-nearest-neighbor-2opt");
  assert.deepEqual(result.visitOrder, [0, 1, 2, 3]);
  assert.deepEqual(result.shortestPathsFromOrigin, [0, 3, 2, 5]);
  assert.deepEqual(result.previous, [null, 2, 0, 2]);
  assert.equal(result.mst.totalWeight, 6);
  assert.deepEqual(result.mst.edges, [
    { fromIndex: 0, toIndex: 2, weight: 2 },
    { fromIndex: 2, toIndex: 1, weight: 1 },
    { fromIndex: 2, toIndex: 3, weight: 3 },
  ]);
});
