import axios from 'axios';
import logger from '../logger';

const MNOTIFY_API_KEY = process.env.MNOTIFY_API_KEY || '';
const MNOTIFY_SENDER_ID = process.env.MNOTIFY_SENDER_ID || 'SKYNET';

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

  try {
    const { data } = await axios.post(
      `https://api.mnotify.com/api/sms/quick?key=${MNOTIFY_API_KEY}`,
      {
        recipient: [phone],
        sender: MNOTIFY_SENDER_ID,
        message,
        is_schedule: false,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000,
      },
    );
    logger.info({ phone, response: data }, 'SMS sent');
  } catch (err) {
    logger.error({ phone, err }, 'SMS send failed');
  }
}
