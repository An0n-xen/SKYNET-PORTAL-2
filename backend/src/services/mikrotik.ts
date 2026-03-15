import axios from 'axios';
import http from 'http';

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
  headers: { 'Content-Type': 'application/json' },
  httpAgent: keepAliveAgent,
  timeout: 10000,
});

export async function createUser(name: string, password: string): Promise<void> {
  await api.post('/rest/user-manager/user/add', {
    name,
    password,
    group: 'default',
  });
}

export async function assignProfile(user: string, profile: string): Promise<void> {
  await api.post('/rest/user-manager/user-profile/add', { user, profile });
}

export async function createUserWithProfile(
  name: string,
  password: string,
  profile: string,
): Promise<void> {
  const t0 = Date.now();
  await api.post('/rest/user-manager/user/add', {
    name,
    password,
    group: 'default',
  });
  console.log(`[mikrotik] createUser took ${Date.now() - t0}ms`);

  const t1 = Date.now();
  await api.post('/rest/user-manager/user-profile/add', { user: name, profile });
  console.log(`[mikrotik] assignProfile took ${Date.now() - t1}ms`);
  console.log(`[mikrotik] total took ${Date.now() - t0}ms`);
}

export async function listUsers(): Promise<unknown[]> {
  const { data } = await api.get('/rest/user-manager/user/print');
  return data;
}

export async function removeUser(id: string): Promise<void> {
  await api.post('/rest/user-manager/user/remove', { '.id': id });
}
