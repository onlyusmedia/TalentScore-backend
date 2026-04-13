const express = require('express');
const { internalAuth } = require('../middleware/internalAuth');
const Role = require('../models/Role');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const { sendJobUpdate } = require('../services/sse');
const { deductCredit } = require('../services/credit');

const router = express.Router();

// All internal routes require API key auth
router.use(internalAuth);

/**
 * PATCH /api/internal/roles/:id
 * Update role with AI-generated results (called by n8n)
 */
router.patch('/roles/:id', async (req, res) => {
  try {
    const {
      improvedJobDescription,
      scoringCategories,
      marketFeedback,
      processingStatus,
    } = req.body;

    const updates = {};
    if (improvedJobDescription) updates.improvedJobDescription = improvedJobDescription;
    if (scoringCategories) updates.scoringCategories = scoringCategories;
    if (marketFeedback) updates.marketFeedback = marketFeedback;
    if (processingStatus) {
      if (processingStatus.jobPostImprovement) {
        updates['processingStatus.jobPostImprovement'] = processingStatus.jobPostImprovement;
      }
      if (processingStatus.categoryGeneration) {
        updates['processingStatus.categoryGeneration'] = processingStatus.categoryGeneration;
      }
    }

    // If both are done, mark role as active
    const role = await Role.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    if (
      role.processingStatus.jobPostImprovement === 'done' &&
      role.processingStatus.categoryGeneration === 'done'
    ) {
      role.status = 'active';
      await role.save();
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Internal] Role update error:', error.message);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * PATCH /api/internal/candidates/:id
 * Update candidate with AI-generated results (called by n8n)
 */
router.patch('/candidates/:id', async (req, res) => {
  try {
    const updates = {};
    const { resume, interview, interviewQuestions, scores } = req.body;

    // Resume analysis results
    if (resume) {
      if (resume.extractedText !== undefined) updates['resume.extractedText'] = resume.extractedText;
      if (resume.summary) updates['resume.summary'] = resume.summary;
      if (resume.strengths) updates['resume.strengths'] = resume.strengths;
      if (resume.concerns) updates['resume.concerns'] = resume.concerns;
      if (resume.embedding) updates['resume.embedding'] = resume.embedding;
      if (resume.processingStatus) updates['resume.processingStatus'] = resume.processingStatus;
      if (resume.processedAt) updates['resume.processedAt'] = resume.processedAt;
      if (resume.processingError) updates['resume.processingError'] = resume.processingError;
    }

    // Name and email from resume extraction
    if (req.body.name) updates.name = req.body.name;
    if (req.body.email) updates.email = req.body.email;

    // Interview results
    if (interview) {
      if (interview.transcriptRaw) updates['interview.transcriptRaw'] = interview.transcriptRaw;
      if (interview.transcriptStructured) updates['interview.transcriptStructured'] = interview.transcriptStructured;
      if (interview.processingStatus) updates['interview.processingStatus'] = interview.processingStatus;
      if (interview.processedAt) updates['interview.processedAt'] = interview.processedAt;
      if (interview.processingError) updates['interview.processingError'] = interview.processingError;
    }

    // Interview questions
    if (interviewQuestions) {
      updates.interviewQuestions = interviewQuestions;
    }

    // Scoring results
    if (scores) {
      updates.scores = scores;

      // Deduct credit on successful scoring
      if (scores.processingStatus === 'done') {
        const candidate = await Candidate.findById(req.params.id);
        if (candidate && !candidate.creditDeducted) {
          await deductCredit(candidate.userId, candidate.roleId, candidate._id);
          updates.creditDeducted = true;
          updates.creditDeductedAt = new Date();
        }
      }
    }

    const candidate = await Candidate.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true }
    );

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Internal] Candidate update error:', error.message);
    res.status(500).json({ error: 'Failed to update candidate' });
  }
});

/**
 * POST /api/internal/jobs/:id/complete
 * Mark a job as complete (called by n8n)
 */
router.post('/jobs/:id/complete', async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: 'done',
          progress: 100,
          result: req.body.result || null,
        },
      },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Send SSE notification to user
    sendJobUpdate(job.userId, job._id, 'done', 100, req.body.result);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete job' });
  }
});

/**
 * POST /api/internal/jobs/:id/fail
 * Mark a job as failed (called by n8n)
 */
router.post('/jobs/:id/fail', async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: 'failed',
          error: req.body.error || 'Unknown error',
        },
      },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    sendJobUpdate(job.userId, job._id, 'failed', 0, { error: req.body.error });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update job' });
  }
});

/**
 * POST /api/internal/jobs/:id/progress
 * Update job progress (called by n8n during processing)
 */
router.post('/jobs/:id/progress', async (req, res) => {
  try {
    const { progress, message } = req.body;

    const job = await Job.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: 'processing',
          progress: progress || 0,
        },
      },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    sendJobUpdate(job.userId, job._id, 'processing', progress, { message });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update progress' });
  }
});

/**
 * ═══════════════════════════════════════════════════════
 * n8n WORKFLOW CALLBACKS (named endpoints)
 * These are called directly by n8n workflows after AI processing
 * ═══════════════════════════════════════════════════════
 */

/**
 * POST /api/internal/role-setup-complete
 * Called by n8n after role analysis (JD improvement + category generation)
 */
router.post('/role-setup-complete', async (req, res) => {
  try {
    const { roleId, improvedJobDescription, scoringCategories, marketFeedback } = req.body;

    const role = await Role.findByIdAndUpdate(roleId, {
      $set: {
        improvedJobDescription,
        scoringCategories,
        marketFeedback,
        'processingStatus.jobPostImprovement': 'done',
        'processingStatus.categoryGeneration': 'done',
        status: 'active',
      },
    }, { new: true });

    if (!role) return res.status(404).json({ error: 'Role not found' });

    // Complete the associated job
    await Job.findOneAndUpdate(
      { entityId: roleId, type: 'role-setup', status: { $ne: 'done' } },
      { $set: { status: 'done', progress: 100 } }
    );

    // Send SSE update
    sendJobUpdate(role.userId.toString(), null, 'done', 100, { type: 'role-setup', roleId });

    console.log(`[Internal] Role setup complete: ${roleId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Internal] Role setup callback error:', error.message);
    res.status(500).json({ error: 'Failed to process role setup callback' });
  }
});

/**
 * POST /api/internal/resume-parsed
 * Called by n8n after resume analysis
 */
router.post('/resume-parsed', async (req, res) => {
  try {
    const { candidateId, name, email, phone, summary, strengths, concerns, experience, skills } = req.body;

    const candidate = await Candidate.findByIdAndUpdate(candidateId, {
      $set: {
        name: name || 'Unknown',
        email: email || undefined,
        'resume.summary': summary,
        'resume.strengths': strengths || [],
        'resume.concerns': concerns || [],
        'resume.processingStatus': 'done',
        'resume.processedAt': new Date(),
      },
    }, { new: true });

    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    // Complete the associated job
    await Job.findOneAndUpdate(
      { entityId: candidateId, type: 'resume-parse', status: { $ne: 'done' } },
      { $set: { status: 'done', progress: 100 } }
    );

    sendJobUpdate(candidate.userId.toString(), null, 'done', 100, { type: 'resume-parsed', candidateId });

    console.log(`[Internal] Resume parsed: ${candidateId} → ${name}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Internal] Resume parse callback error:', error.message);
    res.status(500).json({ error: 'Failed to process resume callback' });
  }
});

/**
 * POST /api/internal/questions-generated
 * Called by n8n after interview question generation
 */
router.post('/questions-generated', async (req, res) => {
  try {
    const { candidateId, questions } = req.body;

    const candidate = await Candidate.findByIdAndUpdate(candidateId, {
      $set: {
        interviewQuestions: {
          ...questions,
          processingStatus: 'done',
          generatedAt: new Date(),
        },
      },
    }, { new: true });

    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    console.log(`[Internal] Questions generated for: ${candidateId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Internal] Questions callback error:', error.message);
    res.status(500).json({ error: 'Failed to process questions callback' });
  }
});

/**
 * POST /api/internal/scoring-complete
 * Called by n8n after candidate scoring
 */
router.post('/scoring-complete', async (req, res) => {
  try {
    const {
      candidateId, roleId, categories, overallScore, label,
      executiveSummary, topStrengths, topConcerns, pastProblemMatch, interviewerFeedback,
    } = req.body;

    const candidate = await Candidate.findById(candidateId);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    await Candidate.findByIdAndUpdate(candidateId, {
      $set: {
        'scores.categories': categories,
        'scores.overallScore': overallScore,
        'scores.label': label,
        'scores.executiveSummary': executiveSummary,
        'scores.topStrengths': topStrengths || [],
        'scores.topConcerns': topConcerns || [],
        'scores.pastProblemMatch': pastProblemMatch || {},
        'scores.interviewerFeedback': interviewerFeedback || [],
        'scores.processingStatus': 'done',
        'scores.scoredAt': new Date(),
      },
    });

    // Deduct credit on successful scoring (if not already deducted)
    if (!candidate.creditDeducted) {
      try {
        await deductCredit(candidate.userId, candidate.roleId, candidate._id);
        await Candidate.findByIdAndUpdate(candidateId, {
          $set: { creditDeducted: true, creditDeductedAt: new Date() },
        });
      } catch (creditErr) {
        console.warn(`[Internal] Credit deduction failed for ${candidateId}:`, creditErr.message);
      }
    }

    sendJobUpdate(candidate.userId.toString(), null, 'done', 100, { type: 'scoring-complete', candidateId });

    console.log(`[Internal] Scoring complete: ${candidateId} → ${label} (${overallScore})`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Internal] Scoring callback error:', error.message);
    res.status(500).json({ error: 'Failed to process scoring callback' });
  }
});

/**
 * POST /api/internal/interview-processed
 * Called by n8n after interview transcription
 */
router.post('/interview-processed', async (req, res) => {
  try {
    const { candidateId, transcriptRaw, transcriptStructured } = req.body;

    const candidate = await Candidate.findByIdAndUpdate(candidateId, {
      $set: {
        'interview.transcriptRaw': transcriptRaw,
        'interview.transcriptStructured': transcriptStructured || [],
        'interview.processingStatus': 'done',
        'interview.processedAt': new Date(),
      },
    }, { new: true });

    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });

    sendJobUpdate(candidate.userId.toString(), null, 'done', 100, { type: 'interview-processed', candidateId });

    console.log(`[Internal] Interview processed: ${candidateId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Internal] Interview callback error:', error.message);
    res.status(500).json({ error: 'Failed to process interview callback' });
  }
});

module.exports = router;
