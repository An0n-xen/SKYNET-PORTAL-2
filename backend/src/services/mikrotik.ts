import axios from "axios";
import http from "http";
import logger from "../logger";

const MIKROTIK_URL = process.env.MIKROTIK_API_URL!;
const MIKROTIK_USER = process.env.MIKROTIK_API_USER!;
const MIKROTIK_PASS = process.env.MIKROTIK_API_PASSWORD!;

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
  await api.post("/rest/user-manager/user/add", {
    name,
    password,
    group: "default",
    "shared-users": "1",
  });
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
): Promise<void> {
  const t0 = Date.now();
  const planMap = {
    monthly: "plan-monthly",
    daily: "plan-daily",
    semester: "plan-semester",
  };
  const mikrotikGroup = planMap[profile as keyof typeof planMap] || "plan-daily";
  await api.post("/rest/user-manager/user/add", {
    name,
    password,
    group: "default",
    "shared-users": "1",
    attributes: `Mikrotik-Group:${mikrotikGroup}`,
  });
  logger.info({ user: name, ms: Date.now() - t0 }, "mikrotik createUser");

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
): Promise<{ name: string; password: string } | null> {
  const { data } = await api.get("/rest/user-manager/user");
  const users = Array.isArray(data) ? data : [];
  return users.find((u: any) => u.name === username) ?? null;
}
