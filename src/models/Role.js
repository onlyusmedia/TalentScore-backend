const mongoose = require('mongoose');

const scoringCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  weight: { type: Number, default: 1, min: 1, max: 5 },
  isCustom: { type: Boolean, default: false },
  keyIndicators: [String],
  redFlags: [String],
});

const roleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['setup', 'active', 'closed'],
    default: 'setup',
  },

  // User inputs
  originalJobDescription: { type: String, default: '' },
  payRange: {
    min: Number,
    max: Number,
    currency: { type: String, default: 'USD' },
  },
  priorities: {
    text: { type: String, default: '' },
    audioS3Key: String,
    transcribedPriorities: String,
  },

  // AI-generated outputs
  improvedJobDescription: { type: String, default: '' },
  marketFeedback: {
    salaryRange: { min: Number, max: Number },
    warnings: [String],
  },
  scoringCategories: [scoringCategorySchema],

  // Interview config
  interviewConfig: {
    standardQuestionCount: { type: Number, default: 5 },
    customQuestionCount: { type: Number, default: 3 },
  },

  // Processing status
  processingStatus: {
    jobPostImprovement: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed'],
      default: 'pending',
    },
    categoryGeneration: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed'],
      default: 'pending',
    },
  },

  candidateCount: { type: Number, default: 0 },
}, {
  timestamps: true,
});

roleSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('Role', roleSchema);
