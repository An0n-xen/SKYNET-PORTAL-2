import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import * as paystack from '../services/paystack';
import { createUserWithProfileRetry } from '../services/mikrotik-retry';
import { generateCredentials } from '../services/credentials';
import { sendCredentialsSms } from '../services/sms';
import { getPayment, insertPayment, markSmsSent } from '../services/database';
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
      const phone = metadata?.phone as string | undefined;

      if (!pkgKey || !packages[pkgKey]) {
        logger.error({ reference }, 'webhook: missing or invalid package in metadata');
        res.sendStatus(200);
        return;
      }

      const verification = await paystack.verify(reference);
      if (verification.status !== 'success') {
        logger.warn({ reference, status: verification.status }, 'webhook: payment not confirmed');
        res.sendStatus(200);
        return;
      }

      const pkg = packages[pkgKey];

      // Check SQLite — may have already been processed by /verify
      let existing = getPayment(reference);

      if (existing?.profile_assigned) {
        // Already fully processed — just ensure SMS was sent
        if (phone && !existing.sms_sent) {
          sendCredentialsSms(phone, existing.username, existing.password, pkg.name)
            .then(sent => { if (sent) markSmsSent(reference); })
            .catch(() => {});
        }
        logger.info({ reference }, 'webhook: already processed');
        res.sendStatus(200);
        return;
      }

      let username: string;
      let password: string;
      let loginUrl: string;

      if (existing) {
        // Partial — reuse same credentials
        username = existing.username;
        password = existing.password;
        loginUrl = existing.login_url;
      } else {
        // Not yet processed by /verify
        const creds = generateCredentials();
        username = creds.username;
        password = creds.password;
        loginUrl = `${process.env.HOTSPOT_LOGIN_URL}?username=${username}&password=${password}`;

        insertPayment({
          reference,
          package_key: pkgKey,
          phone: phone || null,
          username,
          password,
          login_url: loginUrl,
        });
      }

      await createUserWithProfileRetry(username, password, pkg.mikrotik_profile, reference);
      logger.info({ username, package: pkgKey, reference }, 'webhook: user created');

      // Send SMS if we have a phone number
      if (phone && !existing?.sms_sent) {
        sendCredentialsSms(phone, username, password, pkg.name)
          .then(sent => { if (sent) markSmsSent(reference); })
          .catch(() => {});
      }
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, 'webhook error');
    res.sendStatus(500);
  }
});

export default router;
