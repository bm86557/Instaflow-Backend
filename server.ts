import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });
dotenv.config();

// Import config (initializes Firebase)
import './server/config/firebase.js';

// Import routes
import authRoutes from './server/routes/auth.routes.js';
import userRoutes from './server/routes/user.routes.js';
import analyticsRoutes from './server/routes/analytics.routes.js';
import automationRoutes from './server/routes/automation.routes.js';
import webhookRoutes from './server/routes/webhook.routes.js';

// Debug: Verify environment variables
console.log('\n🔍 Environment Variables Check:');
console.log('FACEBOOK_APP_ID:', process.env.FACEBOOK_APP_ID ? '✅ Loaded' : '❌ Missing');
console.log('FACEBOOK_APP_SECRET:', process.env.FACEBOOK_APP_SECRET ? '✅ Loaded' : '❌ Missing');
console.log('APP_URL:', process.env.APP_URL || '⚠️  Not set (will auto-detect)');
console.log('SESSION_SECRET:', process.env.SESSION_SECRET ? '✅ Loaded' : '❌ Missing');
console.log('WEBHOOK_VERIFY_TOKEN:', process.env.WEBHOOK_VERIFY_TOKEN ? '✅ Loaded' : '⚠️  Using default');
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', true);

  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  app.use(session({
    name: 'instaflow.sid',
    secret: process.env.SESSION_SECRET || 'instaflow-secret-123',
    resave: true,
    saveUninitialized: true,
    rolling: true,
    proxy: true,
    cookie: { 
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  // Debug endpoint
  app.get('/api/debug/session', (req, res) => {
    res.json({
      sessionID: req.sessionID,
      firebaseUid: (req.session as any).firebaseUid,
      cookies: req.headers.cookie,
      env: process.env.NODE_ENV
    });
  });

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);
  app.use('/api/instagram', analyticsRoutes);
  app.use('/api/automation', automationRoutes);
  app.use('/api/webhooks', webhookRoutes);

  // Instagram callback needs to be at /auth level
  app.use('/auth', authRoutes);

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 Webhook endpoint: http://localhost:${PORT}/api/webhooks/instagram`);
    console.log(`✅ All routes loaded successfully\n`);
  });
}

startServer();
