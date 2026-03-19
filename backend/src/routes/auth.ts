import { Router, Request, Response } from "express";
import { findUser } from "../services/mikrotik";
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

    // Reject usernames with @ — breaks MikroTik REST API
    if (normalized.includes("@")) {
      res.status(400).json({ error: "Invalid username format" });
      return;
    }

    logger.info({ username: normalized }, "auth verify attempt");

    // Verify credentials via MikroTik REST API (TCP — works through WireGuard)
    const user = await findUser(normalized);
    if (!user || user.password !== pin) {
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
    res.status(500).json({ error: "Could not verify credentials — try again" });
  }
});

export default router;
