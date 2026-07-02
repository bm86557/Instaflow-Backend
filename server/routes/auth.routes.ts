import express from 'express';
import axios from 'axios';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { saveInstagramConnection } from '../services/userService.js';

const router = express.Router();

function resolvePublicAppUrl(req: express.Request): string {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('x-forwarded-server')?.split(',')[0]?.trim();
  const host = req.get('host');

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const configuredAppUrl = process.env.APP_URL?.trim();
  if (configuredAppUrl && configuredAppUrl !== 'http://localhost:3000' && configuredAppUrl !== 'http://127.0.0.1:3000') {
    return configuredAppUrl;
  }

  const protocol = forwardedProto || req.protocol || 'http';
  const resolvedHost = forwardedHost || host || 'localhost:3000';
  return `${protocol}://${resolvedHost}`;
}

// Helper for error page
function errorPage(code: string, message: string) {
  return `
    <html>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: white; padding: 2rem; text-align: center;">
        <script>
          if (window.opener) {
            window.opener.postMessage({ type: 'INSTAGRAM_AUTH_ERROR', code: '${code}', message: \`${message}\` }, '*');
          }
        </script>
        <div style="max-width: 400px; padding: 2rem; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,0,0,0.2); border-radius: 2rem;">
          <h2 style="color: #ef4444;">Connection Failed</h2>
          <p style="opacity: 0.6; font-size: 0.9rem; line-height: 1.6;">${message}</p>
          <button onclick="window.close()" style="margin-top: 1.5rem; background: #ef4444; color: white; border: none; padding: 0.6rem 1.5rem; border-radius: 0.8rem; font-weight: bold; cursor: pointer;">Close Window</button>
        </div>
      </body>
    </html>
  `;
}

// 1. Get Instagram Auth URL
router.get('/instagram/url', verifyFirebaseToken, (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  console.log('[Instagram Auth] Getting auth URL for user:', firebaseUid);

  // Store Firebase UID in session for callback
  (req.session as any).firebaseUid = firebaseUid;
  console.log('[Session] Saved firebaseUid to session:', firebaseUid);

  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

  const APP_URL = resolvePublicAppUrl(req);
  (req.session as any).appUrl = APP_URL;
  console.log('[Auth URL] Resolved APP_URL:', APP_URL);

  const REDIRECT_URI = `${APP_URL}/auth/instagram/callback`;

  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.error('[Auth URL] Missing Facebook credentials');
    return res.status(500).json({
      error: 'Missing Facebook credentials in environment variables'
    });
  }

  const scope = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_metadata',
    'instagram_basic',
    'instagram_manage_insights',
    'instagram_manage_comments',
    'business_management'
  ].join(',');

  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${FACEBOOK_APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${scope}&response_type=code&auth_type=rerequest`;

  console.log('[Auth URL] Generated OAuth URL');
  req.session.save((err) => {
    if (err) {
      console.error('[Session] Error saving session:', err);
      return res.status(500).json({ error: 'Failed to initialize session' });
    }
    res.json({ url: authUrl });
  });
});

// 2. Instagram OAuth Callback
router.get('/instagram/callback', async (req, res) => {
  const { code } = req.query;
  const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
  const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;

  const APP_URL = (req.session as any).appUrl || resolvePublicAppUrl(req);
  const REDIRECT_URI = `${APP_URL}/auth/instagram/callback`;

  if (!code) {
    return res.status(400).send('No code provided');
  }

  try {
    // Exchange code for short-lived access token
    const tokenResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        redirect_uri: REDIRECT_URI,
        code
      }
    });

    const shortLivedToken = tokenResponse.data.access_token;
    console.log('[OAuth Callback] Got short-lived access token');

    // Exchange short-lived token for long-lived token (important for reconnect stability)
    // https://developers.facebook.com/docs/facebook-login/guides/access-tokens/#extending
    const longLivedResponse = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        grant_type: 'fb_exchange_token',
        fb_exchange_token: shortLivedToken
      }
    });

    const userAccessToken = longLivedResponse.data.access_token;
    const tokenExpiresInSeconds = longLivedResponse.data.expires_in ?? null;

    console.log('[OAuth Callback] Got long-lived access token. expires_in:', tokenExpiresInSeconds);

    // Get Facebook pages
    const meResponse = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
      params: { access_token: userAccessToken, fields: 'instagram_business_account,name,access_token' }
    });

    const pages = meResponse.data.data;

    if (!pages || pages.length === 0) {
      return res.send(errorPage('NO_PAGES', 'No Facebook Pages found. You need a Page to manage Instagram automations.'));
    }

    const connectedAccount = pages.find((p: any) => p.instagram_business_account);

    if (!connectedAccount) {
      return res.send(errorPage('NO_INSTAGRAM_LINK', 'Your Facebook Page is not linked to an Instagram Business account.'));
    }

    const instagramUserId = connectedAccount.instagram_business_account.id;
    const firebaseUid = (req.session as any).firebaseUid;

    if (!firebaseUid) {
      return res.send(errorPage('SESSION_ERROR', 'Session expired. Please try connecting again.'));
    }

    const profileResponse = await axios.get(`https://graph.facebook.com/v19.0/${instagramUserId}`, {
      params: {
        fields: 'username,profile_picture_url',
        access_token: userAccessToken
      }
    });

    const instagramProfile = {
      username: profileResponse.data.username || null,
      profilePictureUrl: profileResponse.data.profile_picture_url || null
    };

    const tokenMeta = {
      tokenExpiresInSeconds,
      tokenType: (longLivedResponse.data?.token_type as string | undefined) ?? null,
      tokenExpiresAt: typeof tokenExpiresInSeconds === 'number'
        ? new Date(Date.now() + tokenExpiresInSeconds * 1000)
        : null
    };

    const saved = await saveInstagramConnection(firebaseUid, userAccessToken, instagramUserId, tokenMeta, instagramProfile);

    if (!saved) {
      return res.send(errorPage('SAVE_ERROR', 'Failed to save Instagram connection.'));
    }

    // Success
    res.send(`
      <html>
        <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; background: #0f172a; color: white;">
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'INSTAGRAM_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <div style="text-align: center;">
            <h2 style="color: #6366f1;">Authentication Successful!</h2>
            <p style="opacity: 0.6;">This window will close automatically.</p>
          </div>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('OAuth Error:', error.response?.data || error.message);
    res.send(errorPage('OAUTH_ERROR', error.response?.data?.error?.message || error.message));
  }
});

// 3. Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
