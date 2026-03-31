import test from "node:test";
import assert from "node:assert/strict";
import {
  getTypewriterCharacterCount,
  getVisibleTypewriterSegments,
} from "../src/lib/typewriter.js";

test("getTypewriterCharacterCount sums segment text length", () => {
  const segments = [
    { text: "Plan Your " },
    { text: "Perfect", emphasis: true },
    { text: " Journey" },
  ];

  assert.equal(getTypewriterCharacterCount(segments), 25);
});

test("getVisibleTypewriterSegments reveals text progressively across segments", () => {
  const segments = [
    { text: "Plan " },
    { text: "Perfect", emphasis: true },
    { text: " Journey" },
  ];

  const visible = getVisibleTypewriterSegments(segments, 9);

  assert.equal(visible[0].text, "Plan ");
  assert.equal(visible[1].text, "Perf");
  assert.equal(visible[2].text, "");
  assert.equal(visible[1].emphasis, true);
});
