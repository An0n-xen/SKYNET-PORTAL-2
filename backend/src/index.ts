import 'dotenv/config';
import express from 'express';
import path from 'path';
import rateLimit from 'express-rate-limit';
import logger from './logger';

import pagesRouter from './routes/pages';
import packagesRouter from './routes/packages';
import paymentRouter from './routes/payment';
import webhookRouter from './routes/webhook';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'src', 'public')));

// Rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // max 20 payment attempts per IP per window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many payment attempts — please try again later' },
});

app.use('/api/payment', paymentLimiter);

// Routes
app.use('/', pagesRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/paystack', webhookRouter);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'SKYNET Portal running');
  logger.info({
    paystack: process.env.PAYSTACK_SECRET_KEY ? 'loaded' : 'MISSING',
    mikrotik: process.env.MIKROTIK_API_URL || 'MISSING',
    mnotify: process.env.MNOTIFY_API_KEY ? 'loaded' : 'MISSING',
  }, 'Environment check');
});
