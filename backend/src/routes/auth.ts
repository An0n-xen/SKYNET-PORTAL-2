import { Router, Request, Response } from "express";
import { verifyCredentials } from "../services/radius";
import { findUser, findUserProfile, checkAndBindMac, updateUserCallerId, isValidMac } from "../services/mikrotik";
import logger from "../logger";

const router = Router();

const HOTSPOT_LOGIN_URL =
  process.env.HOTSPOT_LOGIN_URL || "http://192.168.100.1/login";

// POST /api/auth/verify
router.post("/verify", async (req: Request, res: Response) => {
  const reqId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    const { username, password } = req.body;

    logger.debug(
      { reqId, hasUsername: !!username, hasPassword: !!password, ip: req.ip },
      "auth verify request received",
    );

    if (!username || !password) {
      logger.warn({ reqId }, "auth verify missing fields");
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const normalized = String(username).trim().toUpperCase();
    const pin = String(password).trim();

    // Reject usernames with @ — breaks MikroTik RADIUS and REST API
    if (normalized.includes("@")) {
      logger.warn({ reqId, username: normalized }, "auth verify rejected — @ in username");
      res.status(400).json({ error: "Invalid username format" });
      return;
    }

    logger.info({ reqId, username: normalized, pinLength: pin.length }, "auth verify attempt — looking up user in MikroTik + calling RADIUS");

    // Debug: look up user and profile state in MikroTik before RADIUS call
    try {
      const [userInfo, profileInfo] = await Promise.all([
        findUser(normalized),
        findUserProfile(normalized),
      ]);
      logger.info(
        {
          reqId,
          username: normalized,
          userExists: !!userInfo,
          sharedUsers: userInfo?.["shared-users"] ?? "N/A",
          userGroup: userInfo?.group ?? "N/A",
          userDisabled: userInfo?.disabled ?? "N/A",
          profileAssigned: !!profileInfo,
          profileName: profileInfo?.profile ?? "N/A",
          profileState: profileInfo?.state ?? "N/A",
          profileEndTime: profileInfo?.["end-time"] ?? "N/A",
        },
        "auth verify DEBUG — MikroTik user & profile state before RADIUS",
      );
    } catch (lookupErr: any) {
      logger.warn({ reqId, err: lookupErr.message }, "auth verify DEBUG — MikroTik lookup failed (non-blocking)");
    }

    const t0 = Date.now();
    const valid = await verifyCredentials(normalized, pin);
    const elapsed = Date.now() - t0;

    if (!valid) {
      logger.warn(
        { reqId, username: normalized, elapsed, valid },
        "auth verify FAILED — RADIUS rejected. Possible causes: wrong password, expired profile, shared-users limit reached",
      );
      res
        .status(401)
        .json({ error: "Invalid username or password / Account Expired" });
      return;
    }

    const loginUrl = `${HOTSPOT_LOGIN_URL}?username=${encodeURIComponent(normalized)}&password=${encodeURIComponent(pin)}`;

    // MAC binding
    const { mac } = req.body;
    if (mac && isValidMac(mac)) {
      const bindResult = await checkAndBindMac(normalized, mac);

      if (!bindResult.allowed) {
        logger.warn({ reqId, username: normalized, mac, error: bindResult.error }, "auth verify — MAC bind rejected");
        res.status(403).json({ error: bindResult.error });
        return;
      }

      logger.info({ reqId, username: normalized, mac }, "auth verify SUCCESS — MAC bound, returning login URL");
      res.json({ success: true, loginUrl });

      // Restore caller-id after response is sent (fire-and-forget with delay)
      if (bindResult.needsRestore && bindResult.userId && bindResult.restoreCallerId) {
        const { userId, restoreCallerId } = bindResult;
        setTimeout(async () => {
          try {
            await updateUserCallerId(userId, restoreCallerId);
            logger.info({ reqId, username: normalized, callerId: restoreCallerId }, "auth verify — caller-id restored");
          } catch (err: any) {
            logger.error({ reqId, err: err.message }, "auth verify — failed to restore caller-id");
          }
        }, 3000);
      }
      return;
    }

    if (mac && !isValidMac(mac)) {
      logger.warn({ reqId, mac }, "auth verify — invalid MAC format, skipping binding");
    }

    logger.info(
      { reqId, username: normalized, elapsed, loginUrl },
      "auth verify SUCCESS — returning login URL",
    );
    res.json({ success: true, loginUrl });
  } catch (err: any) {
    logger.error(
      { reqId, err: err.message, stack: err.stack },
      "auth verify EXCEPTION",
    );
    const isTimeout =
      err.message?.includes("retries exceeded") ||
      err.message?.includes("timeout");
    const msg = isTimeout
      ? "Verification timed out — please try again"
      : "Could not verify credentials — try again";
    logger.warn({ reqId, isTimeout }, `auth verify responding with ${isTimeout ? 504 : 500}`);
    res.status(isTimeout ? 504 : 500).json({ error: msg });
  }
});

export default router;
