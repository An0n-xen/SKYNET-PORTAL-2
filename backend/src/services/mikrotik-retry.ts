import * as mikrotik from './mikrotik';
import { getPayment, markMikrotikCreated, markProfileAssigned } from './database';
import logger from '../logger';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createUserWithProfileRetry(
  name: string,
  password: string,
  profile: string,
  reference: string,
): Promise<void> {
  const existing = getPayment(reference);
  if (existing?.profile_assigned) return;

  let userCreated = existing?.mikrotik_created === 1;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Step 1: Create user (if not already created)
      if (!userCreated) {
        // Check MikroTik directly to see if user exists (handles cases where
        // the create request succeeded but the response was lost over WireGuard)
        const found = await mikrotik.findUser(name);
        if (found) {
          logger.info({ user: name, attempt }, 'user already exists on MikroTik, skipping creation');
          markMikrotikCreated(reference);
          userCreated = true;
        } else {
          await mikrotik.createUserDetailed(name, password, profile);
          markMikrotikCreated(reference);
          userCreated = true;
          logger.info({ user: name, attempt }, 'mikrotik user created');
        }
      }

      // Step 2: Assign profile
      await mikrotik.assignProfile(name, profile);
      markProfileAssigned(reference);
      logger.info({ user: name, profile, attempt }, 'mikrotik profile assigned');
      return;

    } catch (err) {
      logger.warn({ user: name, attempt, err }, 'MikroTik attempt failed');
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(`MikroTik user creation failed after ${MAX_RETRIES} attempts for ${name}`);
}
