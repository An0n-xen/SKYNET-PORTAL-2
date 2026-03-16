import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as paystack from '../services/paystack';
import * as mikrotik from '../services/mikrotik';
import { generateCredentials } from '../services/credentials';
import { packages } from './packages';
import logger from '../logger';

const router = Router();

// POST /api/paystack/webhook
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY!;
    const signature = req.headers['x-paystack-signature'] as string;

    const hash = crypto
      .createHmac('sha512', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== signature) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.body;

    if (event.event === 'charge.success') {
      const { reference, metadata } = event.data;
      const pkgKey = metadata?.package as string;

      if (!pkgKey || !packages[pkgKey]) {
        logger.error({ reference }, 'webhook: missing or invalid package in metadata');
        res.sendStatus(200);
        return;
      }

      const verification = await paystack.verify(reference);

      if (verification.status === 'success') {
        const { username, password } = generateCredentials();
        const pkg = packages[pkgKey];

        await mikrotik.createUserWithProfile(username, password, pkg.mikrotik_profile);

        logger.info({ username, package: pkgKey, reference }, 'webhook: user created');
      }
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, 'webhook error');
    res.sendStatus(500);
  }
});

export default router;
