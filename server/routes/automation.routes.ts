import express from 'express';
import { verifyFirebaseToken } from '../middleware/auth.js';
import { validateRuleData, verifyRuleOwnership } from '../services/automationService.js';
import { db, admin } from '../config/firebase.js';

const router = express.Router();

// 1. CREATE AUTOMATION RULE
router.post('/rules', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  const { keyword, replyMessage, type, enabled, priority, dailyLimit } = req.body;

  console.log('[Automation] Creating rule for user:', firebaseUid);

  try {
    const validation = validateRuleData({ keyword, replyMessage, type });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.errors.join(', ') });
    }

    const normalizedKeyword = keyword.toLowerCase().trim();

    // Check for duplicate keyword
    const existingRules = await db.collection('automationRules')
      .where('userId', '==', firebaseUid)
      .where('keyword', '==', normalizedKeyword)
      .get();

    if (!existingRules.empty) {
      return res.status(400).json({ error: 'A rule with this keyword already exists' });
    }

    const userDoc = await db.collection('users').doc(firebaseUid).get();
    const connectedInstagramUserId = userDoc.exists ? userDoc.data()?.instagramUserId || null : null;

    const ruleData: any = {
      userId: firebaseUid,
      keyword: normalizedKeyword,
      replyMessage: replyMessage.trim(),
      type: type,
      enabled: enabled !== undefined ? enabled : true,
      priority: priority || 1,
      triggerCount: 0,
      successCount: 0,
      failureCount: 0,
      lastTriggeredAt: null,
      dailyLimit: dailyLimit || 0,
      dailyUsage: 0,
      lastResetAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (connectedInstagramUserId) {
      ruleData.instagramUserId = connectedInstagramUserId;
    }

    const docRef = await db.collection('automationRules').add(ruleData);
    const newRule = await docRef.get();

    console.log('[Automation] Rule created:', docRef.id);

    res.status(201).json({
      success: true,
      rule: {
        ruleId: docRef.id,
        ...newRule.data()
      }
    });
  } catch (error: any) {
    console.error('[Automation] Error creating rule:', error.message);
    res.status(500).json({ error: 'Failed to create rule', details: error.message });
  }
});

// 2. GET ALL AUTOMATION RULES
router.get('/rules', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;

  try {
    const snapshot = await db.collection('automationRules')
      .where('userId', '==', firebaseUid)
      .get();

    const rules = snapshot.docs.map(doc => ({
      ruleId: doc.id,
      ...doc.data()
    }));

    rules.sort((a: any, b: any) => (a.priority || 0) - (b.priority || 0));

    res.json({
      success: true,
      rules: rules,
      total: rules.length
    });
  } catch (error: any) {
    console.error('[Automation] Error fetching rules:', error.message);
    res.status(500).json({ error: 'Failed to fetch rules', details: error.message });
  }
});

// 3. GET SINGLE AUTOMATION RULE
router.get('/rules/:ruleId', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  const { ruleId } = req.params;

  try {
    const verification = await verifyRuleOwnership(ruleId, firebaseUid);

    if (!verification.valid) {
      return res.status(verification.error === 'Rule not found' ? 404 : 403)
        .json({ error: verification.error });
    }

    const ruleData = verification.doc!.data();

    res.json({
      success: true,
      rule: {
        ruleId: ruleId,
        ...ruleData
      }
    });
  } catch (error: any) {
    console.error('[Automation] Error fetching rule:', error.message);
    res.status(500).json({ error: 'Failed to fetch rule', details: error.message });
  }
});

// 4. UPDATE AUTOMATION RULE
router.put('/rules/:ruleId', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  const { ruleId } = req.params;
  const updates = req.body;

  try {
    const verification = await verifyRuleOwnership(ruleId, firebaseUid);

    if (!verification.valid) {
      return res.status(verification.error === 'Rule not found' ? 404 : 403)
        .json({ error: verification.error });
    }

    if (updates.keyword !== undefined || updates.replyMessage !== undefined || updates.type !== undefined) {
      const currentData = verification.doc!.data();
      const dataToValidate = {
        keyword: updates.keyword || currentData?.keyword,
        replyMessage: updates.replyMessage || currentData?.replyMessage,
        type: updates.type || currentData?.type
      };

      const validation = validateRuleData(dataToValidate);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.errors.join(', ') });
      }
    }

    if (updates.keyword) {
      updates.keyword = updates.keyword.toLowerCase().trim();

      const existingRules = await db.collection('automationRules')
        .where('userId', '==', firebaseUid)
        .where('keyword', '==', updates.keyword)
        .get();

      const hasDuplicate = existingRules.docs.some(doc => doc.id !== ruleId);
      
      if (hasDuplicate) {
        return res.status(400).json({ error: 'A rule with this keyword already exists' });
      }
    }

    const updateData = {
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await verification.doc!.ref.update(updateData);
    const updatedRule = await verification.doc!.ref.get();

    res.json({
      success: true,
      rule: {
        ruleId: ruleId,
        ...updatedRule.data()
      }
    });
  } catch (error: any) {
    console.error('[Automation] Error updating rule:', error.message);
    res.status(500).json({ error: 'Failed to update rule', details: error.message });
  }
});

// 5. DELETE AUTOMATION RULE
router.delete('/rules/:ruleId', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  const { ruleId } = req.params;

  try {
    const verification = await verifyRuleOwnership(ruleId, firebaseUid);

    if (!verification.valid) {
      return res.status(verification.error === 'Rule not found' ? 404 : 403)
        .json({ error: verification.error });
    }

    await verification.doc!.ref.delete();

    res.json({
      success: true,
      message: 'Rule deleted successfully'
    });
  } catch (error: any) {
    console.error('[Automation] Error deleting rule:', error.message);
    res.status(500).json({ error: 'Failed to delete rule', details: error.message });
  }
});

// 6. TOGGLE AUTOMATION RULE
router.patch('/rules/:ruleId/toggle', verifyFirebaseToken, async (req: any, res) => {
  const firebaseUid = req.firebaseUid;
  const { ruleId } = req.params;

  try {
    const verification = await verifyRuleOwnership(ruleId, firebaseUid);

    if (!verification.valid) {
      return res.status(verification.error === 'Rule not found' ? 404 : 403)
        .json({ error: verification.error });
    }

    const currentData = verification.doc!.data();
    const newEnabledState = !currentData?.enabled;

    await verification.doc!.ref.update({
      enabled: newEnabledState,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const updatedRule = await verification.doc!.ref.get();

    res.json({
      success: true,
      rule: {
        ruleId: ruleId,
        ...updatedRule.data()
      },
      enabled: newEnabledState
    });
  } catch (error: any) {
    console.error('[Automation] Error toggling rule:', error.message);
    res.status(500).json({ error: 'Failed to toggle rule', details: error.message });
  }
});

export default router;
