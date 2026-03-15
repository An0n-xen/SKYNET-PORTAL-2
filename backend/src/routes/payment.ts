import { Router, Request, Response } from 'express';
import axios from 'axios';
import * as paystack from '../services/paystack';
import * as mikrotik from '../services/mikrotik';
import { generateCredentials } from '../services/credentials';
import { packages } from './packages';

const router = Router();

// POST /api/payment/charge
router.post('/charge', async (req: Request, res: Response) => {
  try {
    const { package: pkgKey, phone, provider } = req.body;

    if (!pkgKey || !phone || !provider) {
      res.status(400).json({ error: 'Missing required fields: package, phone, provider' });
      return;
    }

    const pkg = packages[pkgKey];
    if (!pkg) {
      res.status(400).json({ error: 'Invalid package' });
      return;
    }

    const result = await paystack.charge({
      amount: pkg.price,
      phone,
      provider,
    });

    res.json(result);
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error('Charge error:', err.response?.status, JSON.stringify(err.response?.data), err.message, err.code);
    } else if (err instanceof Error) {
      console.error('Charge error:', err.message, err.stack);
    } else {
      console.error('Charge error (raw):', JSON.stringify(err), typeof err);
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
    console.error('OTP error:', (err as Error).message);
    res.status(500).json({ error: 'OTP submission failed' });
  }
});

// POST /api/payment/verify
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { reference, package: pkgKey } = req.body;

    if (!reference || !pkgKey) {
      res.status(400).json({ error: 'Missing required fields: reference, package' });
      return;
    }

    const pkg = packages[pkgKey];
    if (!pkg) {
      res.status(400).json({ error: 'Invalid package' });
      return;
    }

    const verification = await paystack.verify(reference);

    if (verification.status !== 'success') {
      res.status(400).json({ error: 'Payment not confirmed', status: verification.status });
      return;
    }

    const { username, password } = generateCredentials();

    await mikrotik.createUser(username, password);
    await mikrotik.assignProfile(username, pkg.mikrotik_profile);

    const loginUrl = `${process.env.HOTSPOT_LOGIN_URL}?username=${username}&password=${password}`;

    res.json({ success: true, loginUrl });
  } catch (err) {
    console.error('Verify error:', (err as Error).message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

export default router;
