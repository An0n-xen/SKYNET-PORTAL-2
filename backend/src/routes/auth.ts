import { Router, Request, Response } from 'express';
import { findUser } from '../services/mikrotik';
import logger from '../logger';

const router = Router();

const HOTSPOT_LOGIN_URL = process.env.HOTSPOT_LOGIN_URL || 'http://192.168.100.1/login';

// POST /api/auth/verify
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const normalized = String(username).trim().toUpperCase();
    const pin = String(password).trim();

    logger.info({ username: normalized }, 'auth verify attempt');

    const user = await findUser(normalized);

    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    if (user.password !== pin) {
      res.status(401).json({ error: 'Wrong password' });
      return;
    }

    const loginUrl = `${HOTSPOT_LOGIN_URL}?username=${encodeURIComponent(user.name)}&password=${encodeURIComponent(user.password)}`;

    logger.info({ username: normalized }, 'auth verify success');
    res.json({ success: true, loginUrl });
  } catch (err: any) {
    logger.error({ err: err.message }, 'auth verify error');
    res.status(500).json({ error: 'Could not verify credentials — try again' });
  }
});

export default router;
