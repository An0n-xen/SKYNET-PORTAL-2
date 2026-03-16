import { Router, Request, Response } from "express";
import { verifyCredentials } from "../services/radius";
import logger from "../logger";

const router = Router();

const HOTSPOT_LOGIN_URL =
  process.env.HOTSPOT_LOGIN_URL || "http://192.168.100.1/login";

// POST /api/auth/verify
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const normalized = String(username).trim();
    const pin = String(password).trim();

    // Reject usernames with @ — breaks MikroTik RADIUS and REST API
    if (normalized.includes("@")) {
      res.status(400).json({ error: "Invalid username format" });
      return;
    }

    logger.info({ username: normalized }, "auth verify attempt");

    // RADIUS verifies both username existence and password in one call
    const valid = await verifyCredentials(normalized, pin);
    if (!valid) {
      res
        .status(401)
        .json({ error: "Invalid username or password / Account Expired" });
      return;
    }

    const loginUrl = `${HOTSPOT_LOGIN_URL}?username=${encodeURIComponent(normalized)}&password=${encodeURIComponent(pin)}`;

    logger.info({ username: normalized }, "auth verify success");
    res.json({ success: true, loginUrl });
  } catch (err: any) {
    logger.error({ err: err.message }, "auth verify error");
    const isTimeout =
      err.message?.includes("retries exceeded") ||
      err.message?.includes("timeout");
    const msg = isTimeout
      ? "Verification timed out — please try again"
      : "Could not verify credentials — try again";
    res.status(isTimeout ? 504 : 500).json({ error: msg });
  }
});

export default router;
