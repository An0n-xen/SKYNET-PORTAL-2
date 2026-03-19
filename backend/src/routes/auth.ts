import { Router, Request, Response } from "express";
import logger from "../logger";

const router = Router();

const HOTSPOT_LOGIN_URL =
  process.env.HOTSPOT_LOGIN_URL || "http://192.168.100.1/login";

// POST /api/auth/verify
// No backend verification — MikroTik hotspot login handles auth directly
router.post("/verify", (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  const normalized = String(username).trim();
  const pin = String(password).trim();

  const loginUrl = `${HOTSPOT_LOGIN_URL}?username=${encodeURIComponent(normalized)}&password=${encodeURIComponent(pin)}`;

  logger.info({ username: normalized }, "auth redirect");
  res.json({ success: true, loginUrl });
});

export default router;
