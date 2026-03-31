import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveGeminiApiKey,
  resolveGeminiModelName,
} from "../server/services/gemini.js";

test("resolveGeminiApiKey prioritizes server-only environment variables", () => {
  const originalGoogle = process.env.GOOGLE_GEMINI_API_KEY;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalVite = process.env.VITE_GOOGLE_GEMINI_API_KEY;

  try {
    process.env.GOOGLE_GEMINI_API_KEY = "server-google-key";
    process.env.GEMINI_API_KEY = "server-gemini-key";
    process.env.VITE_GOOGLE_GEMINI_API_KEY = "client-key";
    assert.equal(resolveGeminiApiKey(), "server-google-key");

    delete process.env.GOOGLE_GEMINI_API_KEY;
    assert.equal(resolveGeminiApiKey(), "server-gemini-key");

    delete process.env.GEMINI_API_KEY;
    assert.equal(resolveGeminiApiKey(), "");
  } finally {
    if (originalGoogle === undefined) {
      delete process.env.GOOGLE_GEMINI_API_KEY;
    } else {
      process.env.GOOGLE_GEMINI_API_KEY = originalGoogle;
    }

    if (originalGemini === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGemini;
    }

    if (originalVite === undefined) {
      delete process.env.VITE_GOOGLE_GEMINI_API_KEY;
    } else {
      process.env.VITE_GOOGLE_GEMINI_API_KEY = originalVite;
    }
  }
});

test("resolveGeminiModelName falls back to gemini-2.5-flash", () => {
  const originalModel = process.env.GEMINI_MODEL;

  try {
    delete process.env.GEMINI_MODEL;
    assert.equal(resolveGeminiModelName(), "gemini-2.5-flash");

    process.env.GEMINI_MODEL = "gemini-2.5-pro";
    assert.equal(resolveGeminiModelName(), "gemini-2.5-pro");
  } finally {
    if (originalModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = originalModel;
    }
  }
});
