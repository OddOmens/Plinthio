import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth.js';
import { APP_VERSION } from '../config/version.js';
import { getUpdateStatus, checkForUpdate } from '../services/updateCheck.js';

const router = express.Router();

router.use(authenticateToken, requireAdmin);

// Running version plus what the last release check found. ?refresh=1 re-checks now
// (throttled to once a minute server-side, so the button can't be used to hammer GitHub).
router.get('/update', async (req, res) => {
  const status = req.query.refresh === '1' ? await checkForUpdate() : getUpdateStatus();
  res.json({ ...status, current: APP_VERSION });
});

export default router;
