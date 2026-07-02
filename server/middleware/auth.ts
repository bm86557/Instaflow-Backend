import { admin } from '../config/firebase.js';

/**
 * Middleware to verify Firebase ID token
 */
export const verifyFirebaseToken = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[Auth] No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.firebaseUid = decodedToken.uid;
    req.userEmail = decodedToken.email;
    
    console.log('[Auth] Token verified for:', decodedToken.uid);
    next();
  } catch (error: any) {
    console.error('[Auth] Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
};
