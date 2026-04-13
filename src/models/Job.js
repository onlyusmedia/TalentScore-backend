const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['role-setup', 'resume-parse', 'transcribe-interview', 'generate-questions', 'score-candidates'],
    required: true,
  },
  status: {
    type: String,
    enum: ['queued', 'processing', 'done', 'failed'],
    default: 'queued',
  },
  relatedEntity: {
    type: { type: String, enum: ['role', 'candidate'] },
    id: mongoose.Schema.Types.ObjectId,
  },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  result: mongoose.Schema.Types.Mixed,
  error: String,
}, {
  timestamps: true,
});

jobSchema.index({ userId: 1, status: 1 });
jobSchema.index({ 'relatedEntity.id': 1 });

module.exports = mongoose.model('Job', jobSchema);
