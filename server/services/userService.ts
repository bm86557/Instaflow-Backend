import { db, admin } from '../config/firebase.js';

/**
 * Get user data from Firestore
 */
export async function getUserData(firebaseUid: string) {
  try {
    const userDoc = await db.collection('users').doc(firebaseUid).get();

    if (!userDoc.exists) {
      return null;
    }

    return userDoc.data();
  } catch (error) {
    console.error('[Firestore] Error getting user:', error);
    return null;
  }
}

/**
 * Create or update user in Firestore
 */
export async function saveUserData(firebaseUid: string, data: any) {
  try {
    await db.collection('users').doc(firebaseUid).set(data, { merge: true });
    console.log('[Firestore] User data saved:', firebaseUid);
    return true;
  } catch (error) {
    console.error('[Firestore] Error saving user:', error);
    return false;
  }
}

/**
 * Save Instagram connection data
 */
export async function saveInstagramConnection(
  firebaseUid: string,
  accessToken: string,
  instagramUserId: string,
  tokenMeta?: {
    tokenExpiresAt?: Date | null;
    tokenExpiresInSeconds?: number | null;
    tokenType?: string | null;
  },
  instagramProfile?: {
    username?: string | null;
    profilePictureUrl?: string | null;
  }
) {
  try {
    const userData: any = {
      instagramAccessToken: accessToken,
      instagramUserId: instagramUserId,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (instagramProfile) {
      if (typeof instagramProfile.username === 'string') {
        userData.instagramUsername = instagramProfile.username;
      }
      if (typeof instagramProfile.profilePictureUrl === 'string') {
        userData.instagramProfilePictureUrl = instagramProfile.profilePictureUrl;
      }
    }

    // Token metadata (optional)
    if (tokenMeta) {
      if (typeof tokenMeta.tokenExpiresInSeconds === 'number') {
        userData.tokenExpiresInSeconds = tokenMeta.tokenExpiresInSeconds;
      }
      if (tokenMeta.tokenType) {
        userData.instagramTokenType = tokenMeta.tokenType;
      }
      if (tokenMeta.tokenExpiresAt) {
        userData.tokenExpiresAt = admin.firestore.Timestamp.fromDate(tokenMeta.tokenExpiresAt);
      }
    }

    await db.collection('users').doc(firebaseUid).set(userData, { merge: true });
    console.log('[Firestore] Instagram connection saved:', firebaseUid);
    return true;
  } catch (error) {
    console.error('[Firestore] Error saving Instagram connection:', error);
    return false;
  }
}
