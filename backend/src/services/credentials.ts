import crypto from 'crypto';

// Exclude ambiguous characters: 0/O, 1/I/L
const SAFE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomChar(): string {
  const index = crypto.randomInt(0, SAFE_CHARS.length);
  return SAFE_CHARS[index];
}

export function generateCredentials(): { username: string; password: string } {
  const suffix = Array.from({ length: 4 }, randomChar).join('');
  const username = `SKY-${suffix}`;
  const password = String(crypto.randomInt(1000, 10000));

  return { username, password };
}
