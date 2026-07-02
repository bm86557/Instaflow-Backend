import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import serviceAccount from '../../../serviceAccountKey.json' assert { type: 'json' };

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount)
});

// Initialize Firestore
export const db = getFirestore();
export { admin };

console.log('✅ Firebase Admin initialized');
