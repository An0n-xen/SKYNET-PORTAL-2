import { Router } from 'express';
import path from 'path';

const router = Router();

router.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'src', 'public', 'index.html'));
});

export default router;
