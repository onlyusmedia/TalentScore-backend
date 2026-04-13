const User = require('../models/User');
const UsageRecord = require('../models/UsageRecord');

/**
 * Deduct a credit for a candidate evaluation
 * @param {string} userId
 * @param {string} roleId
 * @param {string} candidateId
 * @returns {{ success: boolean, isOverage: boolean }}
 */
const deductCredit = async (userId, roleId, candidateId) => {
  // Check if already billed (re-scoring is free)
  const existing = await UsageRecord.findOne({ candidateId });
  if (existing) {
    return { success: true, isOverage: false, alreadyBilled: true };
  }

  const user = await User.findById(userId);
  const creditsUsed = user.plan.creditsUsed;
  const creditsIncluded = user.plan.creditsIncluded;
  const isOverage = creditsUsed >= creditsIncluded;

  const now = new Date();
  const billingCycleId = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Create usage record
  await UsageRecord.create({
    userId,
    roleId,
    candidateId,
    action: 'candidate_evaluation',
    creditCost: 1,
    billingCycleId,
    isOverage,
  });

  // Update user credits used
  await User.findByIdAndUpdate(userId, {
    $inc: { 'plan.creditsUsed': 1 },
  });

  return { success: true, isOverage, alreadyBilled: false };
};

/**
 * Get credit summary for a user
 */
const getCreditSummary = async (userId) => {
  const user = await User.findById(userId);
  const totalCredits = user.plan.creditsIncluded + user.plan.overageCredits;
  const creditsUsed = user.plan.creditsUsed;
  const creditsRemaining = Math.max(0, totalCredits - creditsUsed);

  return {
    plan: user.plan.type,
    creditsIncluded: user.plan.creditsIncluded,
    creditsUsed,
    creditsRemaining,
    overageCredits: user.plan.overageCredits,
    billingCycleEnd: user.plan.billingCycleEnd,
  };
};

module.exports = { deductCredit, getCreditSummary };
