import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { resolveRoleCapabilities, USER_ROLE } from "../lib/rbac.js";

const router = express.Router();

function normalizeText(value) {
  return String(value ?? "").trim();
}

export function buildAuthSessionResponse(req = {}) {
  const authContext = req?.authContext ?? {};
  const user = req?.user ?? {};
  const uid = normalizeText(authContext.uid || user.uid);
  const email = normalizeText(authContext.email || user.email);
  const displayName = normalizeText(authContext.displayName || user.name || user.displayName);
  const role = normalizeText(authContext.role || user.role) || USER_ROLE;
  const capabilities =
    authContext.capabilities && typeof authContext.capabilities === "object"
      ? authContext.capabilities
      : resolveRoleCapabilities(role);

  return {
    user: {
      uid,
      email,
      displayName,
    },
    role,
    capabilities,
  };
}

router.get("/session", requireAuth, (req, res) => {
  const session = buildAuthSessionResponse(req);
  console.info("[auth] Session metadata resolved", {
    uid: session.user.uid,
    email: session.user.email,
    role: session.role,
    traceId: req.traceId ?? null,
  });
  res.json(session);
});

export default router;
