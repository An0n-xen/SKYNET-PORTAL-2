import { Router, Request, Response } from 'express';
import axios from 'axios';
import * as paystack from '../services/paystack';
import { createUserWithProfileRetry } from '../services/mikrotik-retry';
import { generateCredentials } from '../services/credentials';
import { sendCredentialsSms } from '../services/sms';
import { getPayment, insertPayment, markSmsSent } from '../services/database';
import { packages } from './packages';
import logger from '../logger';

const router = Router();

// Validate and normalize Ghana phone numbers (10 digits starting with 0)
function validatePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (/^0[235]\d{8}$/.test(cleaned)) return cleaned;
  return null;
}

// POST /api/payment/charge
router.post('/charge', async (req: Request, res: Response) => {
  try {
    const { package: pkgKey, phone, provider } = req.body;

    if (!pkgKey || !phone || !provider) {
      res.status(400).json({ error: 'Missing required fields: package, phone, provider' });
      return;
    }

    const validPhone = validatePhone(phone);
    if (!validPhone) {
      res.status(400).json({ error: 'Enter a valid Ghana phone number (e.g. 024 123 4567)' });
      return;
    }

    const pkg = packages[pkgKey];
    if (!pkg) {
      res.status(400).json({ error: 'Invalid package' });
      return;
    }

    const result = await paystack.charge({
      amount: pkg.price,
      phone: validPhone,
      provider,
      packageKey: pkgKey,
    });

    logger.info({ package: pkgKey, amount: pkg.price, status: result.status, reference: result.reference, message: result.message }, 'paystack charge response');

    res.json(result);
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      logger.error({ status: err.response?.status, data: err.response?.data, code: err.code }, 'charge failed');
    } else {
      logger.error({ err }, 'charge failed');
    }
    res.status(500).json({ error: 'Payment initiation failed' });
  }
});

// POST /api/payment/submit-otp
router.post('/submit-otp', async (req: Request, res: Response) => {
  try {
    const { otp, reference } = req.body;

    if (!otp || !reference) {
      res.status(400).json({ error: 'Missing required fields: otp, reference' });
      return;
    }

    const result = await paystack.submitOtp({ otp, reference });
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'OTP submission failed');
    res.status(500).json({ error: 'OTP submission failed' });
  }
});

// POST /api/payment/verify
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { reference, package: pkgKey, phone } = req.body;

    if (!reference || !pkgKey) {
      res.status(400).json({ error: 'Missing required fields: reference, package' });
      return;
    }

    const pkg = packages[pkgKey];
    if (!pkg) {
      res.status(400).json({ error: 'Invalid package' });
      return;
    }

    const t0 = Date.now();
    const verification = await paystack.verify(reference);
    logger.info({ reference, status: verification.status, ms: Date.now() - t0 }, 'paystack verify');

    if (verification.status !== 'success') {
      res.status(400).json({ error: 'Payment not confirmed', status: verification.status });
      return;
    }

    // Check SQLite for existing record (handles retries, restarts, dedup)
    let existing = getPayment(reference);

    if (existing?.profile_assigned) {
      logger.info({ reference }, 'verify: returning cached credentials');
      res.json({
        success: true,
        loginUrl: existing.login_url,
        username: existing.username,
        password: existing.password,
        packageName: pkg.name,
        smsSent: existing.sms_sent === 1,
      });
      return;
    }

    let username: string;
    let password: string;
    let loginUrl: string;

    if (existing) {
      // Partial completion — reuse same credentials
      username = existing.username;
      password = existing.password;
      loginUrl = existing.login_url;
    } else {
      // Fresh payment — generate new credentials
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

    // Create MikroTik user with retries (checks MikroTik before creating to prevent duplicates)
    await createUserWithProfileRetry(username, password, pkg.mikrotik_profile, reference);

    logger.info({ username, package: pkgKey, totalMs: Date.now() - t0 }, 'user created');

    // Send SMS (fire-and-forget, but track success)
    let smsSent = false;
    if (phone && !existing?.sms_sent) {
      sendCredentialsSms(phone, username, password, pkg.name)
        .then(sent => {
          if (sent) markSmsSent(reference);
        })
        .catch(() => {});
    } else if (existing?.sms_sent) {
      smsSent = true;
    }

    res.json({ success: true, loginUrl, username, password, packageName: pkg.name, smsSent });
  } catch (err) {
    logger.error({ err }, 'verify failed');
    res.status(500).json({ error: 'Verification failed — please tap Verify Payment to try again' });
  }
});

export default router;
