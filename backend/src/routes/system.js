import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { APP_VERSION } from '../config/version.js';
import { getUpdateStatus, checkForUpdate } from '../services/updateCheck.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// Running version and the last release check. ?refresh=1 re-checks (throttled to once a minute).
router.get('/update', async (req, res) => {
  const status = req.query.refresh === '1' ? await checkForUpdate() : getUpdateStatus();
  res.json({ ...status, current: APP_VERSION });
});

export default router;
