import { db, admin } from '../config/firebase.js';
import { sendReplyToComment } from './instagramService.js';

/**
 * Process a comment and potentially send an auto-reply
 */
export async function processComment(instagramUserId: string, commentData: any) {
  try {
    const commentId = commentData.id;
    const commentText = commentData.text || '';
    const commenterId = commentData.from?.id;
    const commenterUsername = commentData.from?.username;
    const mediaId = commentData.media?.id;

    console.log('[AutoReply] Processing comment:', commentId);
    console.log('[AutoReply] Comment text:', commentText);
    console.log('[AutoReply] From:', commenterUsername);

    // Step 1: Find the user who owns this Instagram account
    const userSnapshot = await db.collection('users')
      .where('instagramUserId', '==', instagramUserId)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      console.log('[AutoReply] No user found for Instagram ID:', instagramUserId);
      return;
    }

    const userDoc = userSnapshot.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    const accessToken = userData.instagramAccessToken;

    console.log('[AutoReply] Found user:', userId);

    if (!accessToken) {
      console.log('[AutoReply] Missing Instagram access token for user:', userId);
      return;
    }

    // Step 2: Check if already replied to this comment
    const existingReply = await db.collection('replyHistory')
      .where('instagramCommentId', '==', commentId)
      .limit(1)
      .get();

    if (!existingReply.empty) {
      console.log('[AutoReply] Already replied to this comment');
      return;
    }

    // Step 3: Check if it's the user's own comment
    if (commenterId === instagramUserId) {
      console.log('[AutoReply] Ignoring own comment');
      return;
    }

    // Step 4: Get all active automation rules for this user
    const ownerUsersSnapshot = await db.collection('users')
      .where('instagramUserId', '==', instagramUserId)
      .get();

    const candidateUserIds = new Set<string>();
    candidateUserIds.add(userId);
    ownerUsersSnapshot.docs.forEach(ownerDoc => {
      if (ownerDoc.id) {
        candidateUserIds.add(ownerDoc.id);
      }
    });

    const rulesDocs: any[] = [];
    const seenRuleIds = new Set<string>();

    const addRules = (docs: any[]) => {
      docs.forEach(doc => {
        if (!seenRuleIds.has(doc.id)) {
          seenRuleIds.add(doc.id);
          rulesDocs.push(doc);
        }
      });
    };

    for (const candidateUserId of candidateUserIds) {
      const rulesSnapshot = await db.collection('automationRules')
        .where('userId', '==', candidateUserId)
        .where('enabled', '==', true)
        .get();

      addRules(rulesSnapshot.docs);
    }

    if (rulesDocs.length === 0) {
      const fallbackRulesSnapshot = await db.collection('automationRules')
        .where('enabled', '==', true)
        .where('instagramUserId', '==', instagramUserId)
        .get();

      addRules(fallbackRulesSnapshot.docs);
    }

    if (rulesDocs.length === 0) {
      console.log('[AutoReply] No active rules found for Instagram account');
      return;
    }

    console.log('[AutoReply] Found', rulesDocs.length, 'active rules');

    // Step 5: Find a matching rule
    const commentTextLower = (commentText || '').toLowerCase();
    let matchedRule: any = null;

    // Map to array and sort by priority in-memory to avoid Firestore composite index requirement
    const rules: any[] = rulesDocs.map(doc => ({ ruleId: doc.id, ...doc.data() }));
    rules.sort((a: any, b: any) => (a.priority || 0) - (b.priority || 0));

    for (const rule of rules) {
      const keywordRaw = typeof rule.keyword === 'string' ? rule.keyword : '';
      const keyword = keywordRaw.toLowerCase().trim();
      if (!keyword) continue;

      // Simple keyword matching (check if comment contains keyword)
      if (commentTextLower.includes(keyword)) {
        matchedRule = rule;
        console.log('[AutoReply] Matched rule:', matchedRule.ruleId, '- Keyword:', keyword);
        break;
      }
    }

    if (!matchedRule) {
      console.log('[AutoReply] No matching rule found for comment');
      return;
    }

    // Step 6: Check daily limit
    const dailyLimit = typeof matchedRule.dailyLimit === 'number' ? matchedRule.dailyLimit : 0;
    const dailyUsage = typeof matchedRule.dailyUsage === 'number' ? matchedRule.dailyUsage : 0;

    const parseToDate = (value: any): Date => {
      try {
        if (!value) return new Date(0);
        if (typeof value === 'string') return new Date(value);
        // Firestore Timestamp
        if (typeof value?.toDate === 'function') return value.toDate();
        if (value instanceof Date) return value;
        return new Date(0);
      } catch {
        return new Date(0);
      }
    };

    if (dailyLimit > 0) {
      const lastReset = parseToDate(matchedRule.lastResetAt);
      const now = new Date();
      const hoursSinceReset = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

      console.log('[AutoReply] Daily limit check:', {
        ruleId: matchedRule.ruleId,
        dailyLimit,
        dailyUsage,
        lastResetAtRawType: typeof matchedRule.lastResetAt,
        lastResetAtISO: lastReset.toISOString(),
        hoursSinceReset
      });

      let shouldReset = hoursSinceReset >= 24;
      if (Number.isNaN(hoursSinceReset)) shouldReset = true;

      if (shouldReset) {
        // Reset daily usage
        await db.collection('automationRules').doc(matchedRule.ruleId).update({
          dailyUsage: 0,
          lastResetAt: admin.firestore.FieldValue.serverTimestamp()
        });
        matchedRule.dailyUsage = 0;
      }

      // Recompute after potential reset
      const usageToCheck =
        typeof matchedRule.dailyUsage === 'number' ? matchedRule.dailyUsage : dailyUsage;

      // Check if limit reached
      if (usageToCheck >= dailyLimit) {
        console.log('[AutoReply] Daily limit reached for rule:', matchedRule.ruleId);

        // Log rate limited attempt
        await db.collection('replyHistory').add({
          userId: userId,
          ruleId: matchedRule.ruleId,
          instagramMediaId: mediaId,
          instagramCommentId: commentId,
          instagramReplyId: null,
          triggerKeyword: matchedRule.keyword,
          originalComment: commentText,
          originalCommenter: commenterUsername,
          originalCommenterId: commenterId,
          replyMessage: matchedRule.replyMessage,
          status: 'rate_limited',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return;
      }
    }

    // Step 7: Send the reply
    const replyResult = await sendReplyToComment(
      commentId,
      matchedRule.replyMessage,
      accessToken
    );

    if (replyResult.success) {
      // Step 8: Update rule statistics
      await db.collection('automationRules').doc(matchedRule.ruleId).update({
        triggerCount: admin.firestore.FieldValue.increment(1),
        successCount: admin.firestore.FieldValue.increment(1),
        dailyUsage: admin.firestore.FieldValue.increment(1),
        lastTriggeredAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Step 9: Update user's auto-replies stats
      await db.collection('users')
        .doc(userId)
        .collection('stats')
        .doc('autoReplies')
        .set({
          totalCount: admin.firestore.FieldValue.increment(1),
          lastReplyAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      // Step 10: Log to reply history
      await db.collection('replyHistory').add({
        userId: userId,
        ruleId: matchedRule.ruleId,
        instagramMediaId: mediaId,
        instagramCommentId: commentId,
        instagramReplyId: replyResult.replyId || null,
        triggerKeyword: matchedRule.keyword,
        originalComment: commentText,
        originalCommenter: commenterUsername,
        originalCommenterId: commenterId,
        replyMessage: matchedRule.replyMessage,
        status: 'sent',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('[AutoReply] ✅ Reply sent successfully');
    } else {
      // Update failure count
      await db.collection('automationRules').doc(matchedRule.ruleId).update({
        triggerCount: admin.firestore.FieldValue.increment(1),
        failureCount: admin.firestore.FieldValue.increment(1)
      });

      // Log failed attempt
      await db.collection('replyHistory').add({
        userId: userId,
        ruleId: matchedRule.ruleId,
        instagramMediaId: mediaId,
        instagramCommentId: commentId,
        instagramReplyId: null,
        triggerKeyword: matchedRule.keyword,
        originalComment: commentText,
        originalCommenter: commenterUsername,
        originalCommenterId: commenterId,
        replyMessage: matchedRule.replyMessage,
        status: 'failed',
        errorMessage: replyResult.error,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('[AutoReply] ❌ Failed to send reply');
    }
  } catch (error) {
    console.error('[AutoReply] Error processing comment:', error);
  }
}
