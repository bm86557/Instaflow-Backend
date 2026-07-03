import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

function loadServiceAccount(): admin.ServiceAccount | null {
  // 1) JSON directly from env (useful for secret JSON values)
  if (process.env.SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.SERVICE_ACCOUNT_JSON) as admin.ServiceAccount;
    } catch (err) {
      console.error('Failed to parse SERVICE_ACCOUNT_JSON:', err);
    }
  }

  // 2) Path to file provided via env (Render secret file path)
  if (process.env.SERVICE_ACCOUNT_PATH) {
    try {
      const p = path.isAbsolute(process.env.SERVICE_ACCOUNT_PATH)
        ? process.env.SERVICE_ACCOUNT_PATH
        : path.join(process.cwd(), process.env.SERVICE_ACCOUNT_PATH);
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw) as admin.ServiceAccount;
    } catch (err) {
      console.error('Failed to read SERVICE_ACCOUNT_PATH file:', err);
    }
  }

  // 3) Local fallback for dev convenience: project root serviceAccountKey.json
  try {
    const localPath = path.join(process.cwd(), 'serviceAccountKey.json');
    if (fs.existsSync(localPath)) {
      const raw = fs.readFileSync(localPath, 'utf8');
      return JSON.parse(raw) as admin.ServiceAccount;
    }
  } catch (err) {
    console.error('Failed to load local serviceAccountKey.json:', err);
  }

  return null;
}

const serviceAccount = loadServiceAccount();
if (!serviceAccount) {
  throw new Error(
    'Firebase service account not found. Set SERVICE_ACCOUNT_JSON or SERVICE_ACCOUNT_PATH, or place serviceAccountKey.json in project root for local development.'
  );

}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
});

// Initialize Firestore
export const db = getFirestore();
export { admin };

console.log('✅ Firebase Admin initialized');
