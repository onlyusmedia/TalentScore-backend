const mongoose = require('mongoose');

const candidateSchema = new mongoose.Schema({
  roleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: { type: String, default: 'Unknown Candidate' },
  email: { type: String, default: '' },

  // Resume data
  resume: {
    s3Key: String,
    fileName: String,
    fileType: { type: String, enum: ['pdf', 'docx', 'txt'] },
    extractedText: { type: String, default: '' },
    summary: { type: String, default: '' },
    strengths: [String],
    concerns: [String],
    embedding: [Number], // 768-dim vector
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'done', 'failed'],
      default: 'pending',
    },
    processingError: String,
    processedAt: Date,
  },

  // Interview data
  interview: {
    audioS3Key: String,
    videoS3Key: String,
    transcriptRaw: { type: String, default: '' },
    transcriptStructured: [{
      question: String,
      answer: String,
      timestamp: String,
    }],
    processingStatus: {
      type: String,
      enum: ['none', 'pending', 'processing', 'done', 'failed'],
      default: 'none',
    },
    processingError: String,
    processedAt: Date,
  },

  // Interview Questions (candidate-specific)
  interviewQuestions: {
    standard: [{
      question: String,
      category: String,
      followUp: String,
    }],
    candidateSpecific: [{
      question: String,
      rationale: String,
      probing: String,
    }],
    behavioral: [{
      question: String,
      targetBehavior: String,
      redFlagAnswers: [String],
    }],
    processingStatus: {
      type: String,
      enum: ['none', 'pending', 'processing', 'done', 'failed'],
      default: 'none',
    },
    generatedAt: Date,
  },

  // Scoring
  scores: {
    categories: [{
      categoryId: mongoose.Schema.Types.ObjectId,
      categoryName: String,
      score: { type: Number, min: 1, max: 10 },
      explanation: String,
      signals: {
        strengths: [String],
        risks: [String],
        quotes: [String],
      },
    }],
    overallScore: { type: Number, default: 0 },
    label: {
      type: String,
      enum: ['', 'Strong Hire', 'Consider', 'Risky'],
      default: '',
    },
    executiveSummary: { type: String, default: '' },
    topStrengths: [String],
    topConcerns: [String],
    pastProblemMatch: {
      detected: { type: Boolean, default: false },
      details: String,
    },
    interviewerFeedback: [{
      issue: String,
      suggestion: String,
      moment: String,
    }],
    processingStatus: {
      type: String,
      enum: ['none', 'pending', 'processing', 'done', 'failed'],
      default: 'none',
    },
    scoredAt: Date,
  },

  // Credit tracking
  creditDeducted: { type: Boolean, default: false },
  creditDeductedAt: Date,
}, {
  timestamps: true,
});

candidateSchema.index({ roleId: 1, 'scores.overallScore': -1 });

module.exports = mongoose.model('Candidate', candidateSchema);
