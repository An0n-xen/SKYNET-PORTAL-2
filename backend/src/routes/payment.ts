import { Router, Request, Response } from 'express';
import axios from 'axios';
import * as paystack from '../services/paystack';
import * as mikrotik from '../services/mikrotik';
import { generateCredentials } from '../services/credentials';
import { sendCredentialsSms } from '../services/sms';
import { packages } from './packages';
import logger from '../logger';

const router = Router();

// Validate and normalize Ghana phone numbers (10 digits starting with 0)
function validatePhone(phone: string): string | null {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (/^0[235]\d{8}$/.test(cleaned)) return cleaned;
  return null;
}

// Guard against duplicate user creation per payment reference
interface ProcessedResult {
  loginUrl: string;
  username: string;
  password: string;
  packageName: string;
}
const processedReferences = new Map<string, ProcessedResult>();

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
    });

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
    logger.info({ reference, ms: Date.now() - t0 }, 'paystack verify');

    if (verification.status !== 'success') {
      res.status(400).json({ error: 'Payment not confirmed', status: verification.status });
      return;
    }

    // Return cached result if this reference was already processed (prevents duplicate users)
    const cached = processedReferences.get(reference);
    if (cached) {
      logger.info({ reference }, 'verify cache hit');
      res.json({ success: true, ...cached });
      return;
    }

    const { username, password } = generateCredentials();

    const t1 = Date.now();
    await mikrotik.createUserWithProfile(username, password, pkg.mikrotik_profile);
    logger.info({ username, package: pkgKey, mikrotikMs: Date.now() - t1, totalMs: Date.now() - t0 }, 'user created');

    const loginUrl = `${process.env.HOTSPOT_LOGIN_URL}?username=${username}&password=${password}`;

    const result: ProcessedResult = { loginUrl, username, password, packageName: pkg.name };

    // Cache the result so duplicate calls don't create another user
    processedReferences.set(reference, result);

    // Send credentials via SMS (fire-and-forget)
    if (phone) {
      sendCredentialsSms(phone, username, password, pkg.name).catch(() => {});
    }

    res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, 'verify failed');
    res.status(500).json({ error: 'Verification failed — please tap Verify Payment to try again' });
  }
});

export default router;
