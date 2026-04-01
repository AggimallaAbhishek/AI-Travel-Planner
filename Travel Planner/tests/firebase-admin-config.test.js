import test from "node:test";
import assert from "node:assert/strict";
import { resolveFirebaseAdminCredentialConfig } from "../server/lib/firebaseAdmin.js";

test("resolveFirebaseAdminCredentialConfig parses separate Firebase Admin env vars", () => {
  const config = resolveFirebaseAdminCredentialConfig({
    FIREBASE_PROJECT_ID: "travel-planner-3098f",
    FIREBASE_CLIENT_EMAIL:
      "firebase-adminsdk-fbsvc@travel-planner-3098f.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY:
      '"-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----\\n"',
  });

  assert.equal(config.mode, "service_account_env");
  assert.equal(config.projectId, "travel-planner-3098f");
  assert.equal(
    config.clientEmail,
    "firebase-adminsdk-fbsvc@travel-planner-3098f.iam.gserviceaccount.com"
  );
  assert.match(config.privateKey, /BEGIN PRIVATE KEY/);
  assert.match(config.privateKey, /\nabc123\n/);
});

test("resolveFirebaseAdminCredentialConfig parses service account JSON env", () => {
  const config = resolveFirebaseAdminCredentialConfig({
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      project_id: "travel-planner-3098f",
      client_email:
        "firebase-adminsdk-fbsvc@travel-planner-3098f.iam.gserviceaccount.com",
      private_key:
        "-----BEGIN PRIVATE KEY-----\\nabc123\\n-----END PRIVATE KEY-----\\n",
    }),
  });

  assert.equal(config.mode, "service_account_json");
  assert.equal(config.projectId, "travel-planner-3098f");
  assert.match(config.privateKey, /\nabc123\n/);
});

test("resolveFirebaseAdminCredentialConfig rejects partial Firebase Admin env vars", () => {
  assert.throws(
    () =>
      resolveFirebaseAdminCredentialConfig({
        FIREBASE_PROJECT_ID: "travel-planner-3098f",
        FIREBASE_CLIENT_EMAIL:
          "firebase-adminsdk-fbsvc@travel-planner-3098f.iam.gserviceaccount.com",
      }),
    /Incomplete Firebase Admin credentials/i
  );
});

test("resolveFirebaseAdminCredentialConfig falls back to application default when no admin vars are set", () => {
  const config = resolveFirebaseAdminCredentialConfig({});

  assert.equal(config.mode, "application_default");
});
