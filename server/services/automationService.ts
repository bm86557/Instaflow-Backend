import { db, admin } from '../config/firebase.js';

/**
 * Validate rule data
 */
export function validateRuleData(data: any) {
  const errors: string[] = [];

  if (!data.keyword || typeof data.keyword !== 'string' || data.keyword.trim() === '') {
    errors.push('Keyword is required');
  }

  if (!data.replyMessage || typeof data.replyMessage !== 'string' || data.replyMessage.trim() === '') {
    errors.push('Reply message is required');
  }

  if (!data.type || !['COMMENT', 'MESSAGE', 'ALL'].includes(data.type)) {
    errors.push('Invalid type. Must be COMMENT, MESSAGE, or ALL');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check rule ownership
 */
export async function verifyRuleOwnership(ruleId: string, userId: string) {
  try {
    const ruleDoc = await db.collection('automationRules').doc(ruleId).get();
    
    if (!ruleDoc.exists) {
      return { valid: false, error: 'Rule not found' };
    }

    const ruleData = ruleDoc.data();
    
    if (ruleData?.userId !== userId) {
      return { valid: false, error: 'Unauthorized' };
    }

    return { valid: true, doc: ruleDoc };
  } catch (error: any) {
    return { valid: false, error: error.message };
  }
}
