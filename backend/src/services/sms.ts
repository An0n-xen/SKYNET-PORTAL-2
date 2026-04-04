import axios from 'axios';
import logger from '../logger';

const MNOTIFY_API_KEY = process.env.MNOTIFY_API_KEY || '';
const MNOTIFY_SENDER_ID = process.env.MNOTIFY_SENDER_ID || 'SKYNET';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

async function trySend(phone: string, message: string): Promise<void> {
  const { data } = await axios.post(
    `https://api.mnotify.com/api/sms/quick?key=${MNOTIFY_API_KEY}`,
    {
      recipient: [phone],
      sender: MNOTIFY_SENDER_ID,
      message,
      is_schedule: 'false',
      schedule_date: '',
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  );
  logger.info({ phone, status: data?.status, code: data?.code }, 'mNotify response');
}

export async function sendCredentialsSms(
  phone: string,
  username: string,
  password: string,
  packageName: string,
): Promise<void> {
  if (!MNOTIFY_API_KEY) {
    logger.warn('MNOTIFY_API_KEY not set, skipping SMS');
    return;
  }

  const message =
    `SKYNET WiFi\n` +
    `Your ${packageName} plan is active!\n\n` +
    `Username: ${username}\n` +
    `Password: ${password}\n\n` +
    `Keep these credentials safe for reconnecting.`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await trySend(phone, message);
      logger.info({ phone, attempt }, 'SMS sent');
      return;
    } catch (err) {
      logger.warn({ phone, attempt, err }, 'SMS attempt failed');
      if (attempt < MAX_ATTEMPTS) {
        await new Promise<void>(resolve => { setTimeout(resolve, RETRY_DELAY_MS); });
      }
    }
  }

  logger.error({ phone }, `SMS failed after ${MAX_ATTEMPTS} attempts`);
}
