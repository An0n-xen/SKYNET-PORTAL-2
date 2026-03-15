import 'dotenv/config';
import express from 'express';
import path from 'path';

import pagesRouter from './routes/pages';
import packagesRouter from './routes/packages';
import paymentRouter from './routes/payment';
import webhookRouter from './routes/webhook';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'src', 'public')));

// Routes
app.use('/', pagesRouter);
app.use('/api/packages', packagesRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/paystack', webhookRouter);

app.listen(PORT, () => {
  console.log(`SKYNET Portal running on port ${PORT}`);
  console.log(`PAYSTACK_SECRET_KEY: ${process.env.PAYSTACK_SECRET_KEY ? 'loaded (' + process.env.PAYSTACK_SECRET_KEY.slice(0, 12) + '...)' : 'MISSING'}`);
  console.log(`MIKROTIK_API_URL: ${process.env.MIKROTIK_API_URL || 'MISSING'}`);
});
