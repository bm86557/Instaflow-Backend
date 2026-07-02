import express from 'express';
import axios from 'axios';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { getUserData, saveUserData } from '../services/userService.js';
import { admin } from '../config/firebase.js';

const router = express.Router();

// Get User Status
router.get('/status', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  const userEmail = req.userEmail;
  
  console.log('[Status] Checking status for Firebase UID:', firebaseUid);
  
  try {
    const userData = await getUserData(firebaseUid);
    
    if (!userData) {
      console.log('[Status] Creating new user document');
      
      await saveUserData(firebaseUid, {
        email: userEmail,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return res.json({
        connected: false,
        isConnected: false,
        email: userEmail
      });
    }

    let isConnected = false;
    const instagramUserId = userData.instagramUserId || null;
    const instagramAccessToken = userData.instagramAccessToken || null;
    let instagramUsername = userData.instagramUsername || null;
    let instagramProfilePictureUrl = userData.instagramProfilePictureUrl || null;

    if (instagramUserId && instagramAccessToken) {
      try {
        const validationResponse = await axios.get(`https://graph.facebook.com/v19.0/${instagramUserId}`, {
          params: {
            fields: 'id,username,profile_picture_url',
            access_token: instagramAccessToken
          }
        });

        if (validationResponse.data?.id === instagramUserId) {
          isConnected = true;
          instagramUsername = validationResponse.data.username || instagramUsername;
          instagramProfilePictureUrl = validationResponse.data.profile_picture_url || instagramProfilePictureUrl;

          await saveUserData(firebaseUid, {
            instagramUsername,
            instagramProfilePictureUrl,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } catch (error: any) {
        console.error('[Status] Instagram token validation failed:', error.response?.data || error.message);
        isConnected = false;
      }
    }
    
    res.json({
      connected: isConnected,
      isConnected: isConnected,
      email: userData.email || userEmail,
      instagramUserId,
      instagramUsername,
      instagramProfilePictureUrl
    });
    
  } catch (error: any) {
    console.error('[Status] Error:', error.message);
    res.status(500).json({ error: 'Failed to get user status' });
  }
});

export default router;
