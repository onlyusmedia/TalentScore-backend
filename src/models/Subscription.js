const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  plan: {
    type: String,
    enum: ['free_trial', 'starter', 'pro'],
    default: 'free_trial',
  },
  priceMonthly: { type: Number, default: 0 },
  creditsPerCycle: { type: Number, default: 3 },
  overagePricePerCredit: { type: Number, default: 0 },
  stripeSubscriptionId: String,
  status: {
    type: String,
    enum: ['active', 'cancelled', 'past_due', 'trialing'],
    default: 'trialing',
  },
  currentPeriodStart: { type: Date, default: Date.now },
  currentPeriodEnd: {
    type: Date,
    default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Subscription', subscriptionSchema);
