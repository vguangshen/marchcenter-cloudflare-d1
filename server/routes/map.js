import express from '../compat/express.js';
import { authMiddleware, userManagerOnly } from '../middleware/auth.js';
import { getEnv } from '../config/runtime.js';

const router = express.Router();

// Reconstructed from the production map client contract. A JS API Web Key is
// public; the private AMap security code belongs behind the configured proxy.
router.get('/config', authMiddleware, userManagerOnly, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        key: String(getEnv('AMAP_WEB_KEY', '')).trim(),
        serviceHost: String(getEnv('AMAP_SERVICE_HOST', '')).trim()
    });
});

export default router;
