import express from 'express';
import { processComment } from '../services/webhookService.js';

const router = express.Router();

/**
 * Webhook Verification Endpoint
 * Facebook will call this to verify your webhook is legitimate
 */
router.get('/instagram', (req, res) => {
  console.log('[Webhook] Verification request received');
  console.log('[Webhook] Full query params:', req.query);
  console.log('[Webhook] Full URL:', req.url);
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('[Webhook] Mode:', mode);
  console.log('[Webhook] Token:', token);

  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'instaflow_webhook_token_123';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('[Webhook] ✅ Verification successful');
    res.status(200).send(challenge);
  } else {
    console.error('[Webhook] ❌ Verification failed');
    res.status(403).send('Forbidden');
  }
});

/**
 * Webhook Notification Receiver
 * Instagram sends notifications here when comments are posted
 */
router.post('/instagram', async (req, res) => {
  console.log('[Webhook] Notification received');
  
  // Always respond 200 OK immediately to acknowledge receipt
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    // Check if it's an Instagram notification
    if (body.object !== 'instagram') {
      console.log('[Webhook] Not an Instagram notification, ignoring');
      return;
    }

    // Process each entry in the notification
    for (const entry of body.entry || []) {
      const instagramUserId = entry.id;
      
      console.log('[Webhook] Processing entry for Instagram user:', instagramUserId);

      // Process each change in the entry
      for (const change of entry.changes || []) {
        if (change.field === 'comments') {
          const commentData = change.value;
          
          console.log('[Webhook] Comment data:', JSON.stringify(commentData, null, 2));

          // Process the comment asynchronously
          processComment(instagramUserId, commentData).catch(err => {
            console.error('[Webhook] Error in processComment:', err);
          });
        }
      }
    }
  } catch (error) {
    console.error('[Webhook] Error processing notification:', error);
  }
});

export default router;
