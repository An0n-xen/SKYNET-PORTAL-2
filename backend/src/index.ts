import 'dotenv/config';
import express from 'express';
import path from 'path';
import logger from './logger';
import { initDatabase } from './services/database';

import pagesRouter from './routes/pages';
import packagesRouter from './routes/packages';
import paymentRouter from './routes/payment';
import webhookRouter from './routes/webhook';
import authRouter from './routes/auth';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'src', 'public')));

// Routes
app.use('/', pagesRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/paystack', webhookRouter);
app.use('/api/auth', authRouter);

initDatabase();

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'SKYNET Portal running');
  logger.info({
    paystack: process.env.PAYSTACK_SECRET_KEY ? 'loaded' : 'MISSING',
    mikrotik: process.env.MIKROTIK_API_URL || 'MISSING',
    mnotify: process.env.MNOTIFY_API_KEY ? 'loaded' : 'MISSING',
  }, 'Environment check');
});
