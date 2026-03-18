import axios from "axios";
import http from "http";
import logger from "../logger";

const MIKROTIK_URL = process.env.MIKROTIK_API_URL!;
const MIKROTIK_USER = process.env.MIKROTIK_API_USER!;
const MIKROTIK_PASS = process.env.MIKROTIK_API_PASSWORD!;

const MAX_DEVICES = 2;

export function normalizeMac(mac: string): string {
  return mac.trim().toUpperCase();
}

export function isValidMac(mac: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac.trim());
}

export function parseCallerIds(callerId: string): string[] {
  if (!callerId) return [];
  return callerId.split(",").map((m) => m.trim()).filter(Boolean);
}

const keepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 5,
});

const api = axios.create({
  baseURL: MIKROTIK_URL,
  auth: { username: MIKROTIK_USER, password: MIKROTIK_PASS },
  headers: { "Content-Type": "application/json" },
  httpAgent: keepAliveAgent,
  timeout: 15_000,
});

export async function createUser(
  name: string,
  password: string,
): Promise<void> {
  const payload = { name, password, group: "default", "shared-users": "2" };
  logger.debug({ payload }, "mikrotik createUser — sending to user-manager/user/add");
  const { data } = await api.post("/rest/user-manager/user/add", payload);
  logger.debug({ user: name, response: data }, "mikrotik createUser — response");
}

export async function assignProfile(
  user: string,
  profile: string,
): Promise<void> {
  await api.post("/rest/user-manager/user-profile/add", { user, profile });
}

export async function createUserWithProfile(
  name: string,
  password: string,
  profile: string,
  callerId?: string,
): Promise<void> {
  const t0 = Date.now();
  const payload: Record<string, string> = {
    name,
    password,
    group: "default",
    "shared-users": "2",
  };
  if (callerId) {
    payload["caller-id"] = callerId;
  }
  await api.post("/rest/user-manager/user/add", payload);
  logger.info({ user: name, callerId: callerId || "none", ms: Date.now() - t0 }, "mikrotik createUser");

  const t1 = Date.now();
  await api.post("/rest/user-manager/user-profile/add", {
    user: name,
    profile,
  });
  logger.info(
    {
      user: name,
      profile,
      createMs: Date.now() - t1,
      totalMs: Date.now() - t0,
    },
    "mikrotik assignProfile",
  );
}

export async function listUsers(): Promise<unknown[]> {
  const { data } = await api.get("/rest/user-manager/user/print");
  return data;
}

export async function removeUser(id: string): Promise<void> {
  await api.post("/rest/user-manager/user/remove", { ".id": id });
}

export async function findUser(
  username: string,
): Promise<Record<string, any> | null> {
  logger.debug({ username }, "mikrotik findUser — fetching all users");
  const { data } = await api.get("/rest/user-manager/user");
  const users = Array.isArray(data) ? data : [];
  const found = users.find((u: any) => u.name === username) ?? null;
  if (found) {
    logger.debug(
      { username, sharedUsers: found["shared-users"], group: found.group, id: found[".id"], allFields: found },
      "mikrotik findUser — FOUND user with all fields",
    );
  } else {
    logger.warn({ username, totalUsers: users.length }, "mikrotik findUser — user NOT FOUND");
  }
  return found;
}

export async function updateUserCallerId(
  userId: string,
  callerId: string,
): Promise<void> {
  await api.patch(`/rest/user-manager/user/${userId}`, { "caller-id": callerId });
  logger.info({ userId, callerId }, "mikrotik updateUserCallerId");
}

export interface MacBindResult {
  allowed: boolean;
  error?: string;
  needsRestore?: boolean;
  restoreCallerId?: string;
  userId?: string;
}

export async function checkAndBindMac(
  username: string,
  mac: string,
): Promise<MacBindResult> {
  const normalized = normalizeMac(mac);
  if (!isValidMac(normalized)) {
    return { allowed: false, error: "Invalid MAC address" };
  }

  const user = await findUser(username);
  if (!user) {
    return { allowed: false, error: "User not found" };
  }

  const userId = user[".id"];
  const currentCallerId = user["caller-id"] || "";
  const macs = parseCallerIds(currentCallerId);

  // Already bound — returning device
  if (macs.includes(normalized)) {
    logger.info({ username, mac: normalized }, "MAC already bound — returning device");
    // Still need to temporarily clear caller-id for login
    await updateUserCallerId(userId, "");
    return { allowed: true, needsRestore: true, restoreCallerId: currentCallerId, userId };
  }

  // Too many devices
  if (macs.length >= MAX_DEVICES) {
    logger.warn({ username, mac: normalized, currentMacs: macs }, "MAC bind rejected — max devices reached");
    return { allowed: false, error: "Maximum devices reached (2). Remove a device first." };
  }

  // Room for new device — add MAC
  const newCallerIdList = [...macs, normalized];
  const newCallerId = newCallerIdList.join(",");

  // Clear caller-id so MikroTik accepts the login
  await updateUserCallerId(userId, "");
  logger.info({ username, mac: normalized, newCallerId }, "MAC bind — cleared caller-id for login");

  return { allowed: true, needsRestore: true, restoreCallerId: newCallerId, userId };
}

export async function findUserProfile(
  username: string,
): Promise<Record<string, any> | null> {
  logger.debug({ username }, "mikrotik findUserProfile — fetching user-profiles");
  const { data } = await api.get("/rest/user-manager/user-profile");
  const profiles = Array.isArray(data) ? data : [];
  const found = profiles.find((p: any) => p.user === username) ?? null;
  if (found) {
    logger.debug(
      { username, profile: found.profile, state: found.state, endTime: found["end-time"], allFields: found },
      "mikrotik findUserProfile — FOUND profile assignment",
    );
  } else {
    logger.warn({ username }, "mikrotik findUserProfile — NO profile assigned");
  }
  return found;
}
