import { getAdminAuth } from "../lib/firebaseAdmin.js";

export async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization ?? "";

  if (!authorization.startsWith("Bearer ")) {
    res.status(401).json({
      message: "Authentication is required.",
    });
    return;
  }

  const idToken = authorization.replace("Bearer ", "").trim();

  try {
    req.user = await getAdminAuth().verifyIdToken(idToken);
    next();
  } catch (error) {
    console.error("[auth] Failed to verify Firebase ID token", error);
    res.status(401).json({
      message: "Your session is no longer valid. Please sign in again.",
    });
  }
}
