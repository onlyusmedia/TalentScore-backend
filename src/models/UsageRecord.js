const mongoose = require('mongoose');

const usageRecordSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  roleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
  },
  candidateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Candidate',
    required: true,
  },
  action: {
    type: String,
    enum: ['candidate_evaluation'],
    default: 'candidate_evaluation',
  },
  creditCost: { type: Number, default: 1 },
  billingCycleId: String, // "2026-04"
  isOverage: { type: Boolean, default: false },
}, {
  timestamps: true,
});

usageRecordSchema.index({ userId: 1, billingCycleId: 1 });
usageRecordSchema.index({ candidateId: 1 }, { unique: true });

module.exports = mongoose.model('UsageRecord', usageRecordSchema);
