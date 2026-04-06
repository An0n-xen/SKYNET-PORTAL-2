import axios from 'axios';
import https from 'https';

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY!;
const BASE_URL = 'https://api.paystack.co';

const keepAliveAgent = new https.Agent({ keepAlive: true });

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${PAYSTACK_SECRET}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
  httpsAgent: keepAliveAgent,
});

interface ChargeParams {
  amount: number;
  phone: string;
  provider: 'mtn' | 'vod' | 'tgo';
  packageKey: string;
}

interface ChargeResult {
  status: string;
  reference: string;
  display_text?: string;
  message?: string;
}

export async function charge({ amount, phone, provider, packageKey }: ChargeParams): Promise<ChargeResult> {
  const email = `user${Date.now()}@skynet-wifi.com`;

  const { data } = await api.post('/charge', {
    email,
    amount,
    currency: 'GHS',
    mobile_money: { phone, provider },
    metadata: { package: packageKey, phone },
  });

  return {
    status: data.data.status,
    reference: data.data.reference,
    display_text: data.data.display_text,
    message: data.message,
  };
}

interface SubmitOtpParams {
  otp: string;
  reference: string;
}

export async function submitOtp({ otp, reference }: SubmitOtpParams): Promise<ChargeResult> {
  const { data } = await api.post('/charge/submit_otp', { otp, reference });

  return {
    status: data.data.status,
    reference: data.data.reference,
    display_text: data.data.display_text,
  };
}

interface VerifyResult {
  status: string;
  amount: number;
  reference: string;
}

export async function verify(reference: string): Promise<VerifyResult> {
  const { data } = await api.get(`/transaction/verify/${reference}`);

  return {
    status: data.data.status,
    amount: data.data.amount,
    reference: data.data.reference,
  };
}
