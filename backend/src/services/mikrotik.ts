import axios from 'axios';

const MIKROTIK_URL = process.env.MIKROTIK_API_URL!;
const MIKROTIK_USER = process.env.MIKROTIK_API_USER!;
const MIKROTIK_PASS = process.env.MIKROTIK_API_PASSWORD!;

const api = axios.create({
  baseURL: MIKROTIK_URL,
  auth: { username: MIKROTIK_USER, password: MIKROTIK_PASS },
  headers: { 'Content-Type': 'application/json' },
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

export async function listUsers(): Promise<unknown[]> {
  const { data } = await api.get('/rest/user-manager/user/print');
  return data;
}

export async function removeUser(id: string): Promise<void> {
  await api.post('/rest/user-manager/user/remove', { '.id': id });
}
