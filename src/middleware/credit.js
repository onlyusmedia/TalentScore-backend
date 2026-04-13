const UsageRecord = require('../models/UsageRecord');

/**
 * Credit check middleware
 * Checks if user has enough credits before allowing scoring operations.
 * Expects req.body.candidateIds (array of candidate IDs to score)
 */
const creditCheck = async (req, res, next) => {
  try {
    const user = req.user;
    const candidateIds = req.body.candidateIds || [];
    const candidatesNeeded = candidateIds.length || 1;

    // Count already-billed candidates (re-scoring doesn't cost extra)
    const alreadyBilled = await UsageRecord.countDocuments({
      candidateId: { $in: candidateIds },
    });

    const newCandidates = candidatesNeeded - alreadyBilled;

    if (newCandidates <= 0) {
      // All candidates already billed — free re-score
      req.creditsNeeded = 0;
      return next();
    }

    // Calculate available credits
    const totalCredits = user.plan.creditsIncluded + user.plan.overageCredits;
    const creditsUsed = user.plan.creditsUsed;
    const creditsRemaining = totalCredits - creditsUsed;

    if (creditsRemaining < newCandidates) {
      return res.status(402).json({
        error: 'Insufficient credits',
        creditsRemaining,
        creditsNeeded: newCandidates,
        message: `You need ${newCandidates} credits but only have ${creditsRemaining}. Please upgrade your plan or purchase additional credits.`,
      });
    }

    req.creditsNeeded = newCandidates;
    next();
  } catch (error) {
    console.error('[CreditCheck] Error:', error.message);
    res.status(500).json({ error: 'Credit check failed' });
  }
};

module.exports = { creditCheck };
