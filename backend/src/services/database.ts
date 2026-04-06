import Database from 'better-sqlite3';
import path from 'path';
import logger from '../logger';

let db: Database.Database;

export interface Payment {
  reference: string;
  package_key: string;
  phone: string | null;
  username: string;
  password: string;
  login_url: string;
  mikrotik_created: number;
  profile_assigned: number;
  sms_sent: number;
  created_at: string;
}

export function initDatabase(): void {
  const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'payments.db');

  // Ensure the directory exists
  const dir = path.dirname(dbPath);
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      reference        TEXT PRIMARY KEY,
      package_key      TEXT NOT NULL,
      phone            TEXT,
      username         TEXT NOT NULL,
      password         TEXT NOT NULL,
      login_url        TEXT NOT NULL,
      mikrotik_created INTEGER NOT NULL DEFAULT 0,
      profile_assigned INTEGER NOT NULL DEFAULT 0,
      sms_sent         INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  logger.info({ path: dbPath }, 'SQLite database initialized');
}

export function getPayment(reference: string): Payment | undefined {
  return db.prepare('SELECT * FROM payments WHERE reference = ?').get(reference) as Payment | undefined;
}

export function insertPayment(payment: Omit<Payment, 'mikrotik_created' | 'profile_assigned' | 'sms_sent' | 'created_at'>): void {
  db.prepare(`
    INSERT OR IGNORE INTO payments (reference, package_key, phone, username, password, login_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(payment.reference, payment.package_key, payment.phone, payment.username, payment.password, payment.login_url);
}

export function markMikrotikCreated(reference: string): void {
  db.prepare('UPDATE payments SET mikrotik_created = 1 WHERE reference = ?').run(reference);
}

export function markProfileAssigned(reference: string): void {
  db.prepare('UPDATE payments SET profile_assigned = 1 WHERE reference = ?').run(reference);
}

export function markSmsSent(reference: string): void {
  db.prepare('UPDATE payments SET sms_sent = 1 WHERE reference = ?').run(reference);
}
