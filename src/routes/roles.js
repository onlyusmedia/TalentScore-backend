const express = require('express');
const Role = require('../models/Role');
const Candidate = require('../models/Candidate');
const Job = require('../models/Job');
const { enqueueJob } = require('../services/queue');

const router = express.Router();

/**
 * POST /api/roles
 * Create a new role and trigger AI processing
 */
router.post('/', async (req, res) => {
  try {
    const { title, jobDescription, payRange, priorities, prioritiesAudioS3Key, interviewConfig } = req.body;

    if (!title || !jobDescription) {
      return res.status(400).json({ error: 'Title and job description are required' });
    }

    const role = new Role({
      userId: req.userId,
      title,
      originalJobDescription: jobDescription,
      payRange: payRange || {},
      priorities: {
        text: priorities || '',
        audioS3Key: prioritiesAudioS3Key || null,
      },
      interviewConfig: interviewConfig || { standardQuestionCount: 5, customQuestionCount: 3 },
      status: 'setup',
      processingStatus: {
        jobPostImprovement: 'pending',
        categoryGeneration: 'pending',
      },
    });
    await role.save();

    // Create a job tracker
    const job = await Job.create({
      userId: req.userId,
      type: 'role-setup',
      status: 'queued',
      relatedEntity: { type: 'role', id: role._id },
    });

    // Enqueue AI processing (JD improvement + category generation)
    await enqueueJob('role-setup', {
      entityId: role._id.toString(),
      roleId: role._id.toString(),
      jobId: job._id.toString(),
      userId: req.userId.toString(),
      jobDescription,
      priorities: priorities || '',
      payRange: payRange || {},
    });

    res.status(202).json({
      role: role.toObject(),
      jobId: job._id,
      message: 'Role created. AI is generating scoring categories and improving your job post.',
    });
  } catch (error) {
    console.error('[Roles] Create error:', error.message);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

/**
 * GET /api/roles
 * List all roles for the authenticated user
 */
router.get('/', async (req, res) => {
  try {
    const roles = await Role.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ roles });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

/**
 * GET /api/roles/:id
 * Get role details
 */
router.get('/:id', async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }
    res.json({ role });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch role' });
  }
});

/**
 * PATCH /api/roles/:id
 * Update role (edit categories, config, etc.)
 */
router.patch('/:id', async (req, res) => {
  try {
    const allowedUpdates = [
      'title', 'scoringCategories', 'interviewConfig',
      'improvedJobDescription', 'status', 'payRange',
    ];

    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const role = await Role.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { $set: updates },
      { new: true }
    );

    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    res.json({ role });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * DELETE /api/roles/:id
 * Delete role and all related data
 */
router.delete('/:id', async (req, res) => {
  try {
    const role = await Role.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    // Clean up related data
    await Candidate.deleteMany({ roleId: req.params.id });
    await Job.deleteMany({ 'relatedEntity.id': req.params.id });

    res.json({ message: 'Role and all related data deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete role' });
  }
});

/**
 * POST /api/roles/:id/generate-questions
 * Trigger interview question generation for all candidates
 */
router.post('/:id/generate-questions', async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, userId: req.userId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const candidates = await Candidate.find({
      roleId: req.params.id,
      'resume.processingStatus': 'done',
    });

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No processed resumes found. Upload resumes first.' });
    }

    const job = await Job.create({
      userId: req.userId,
      type: 'generate-questions',
      status: 'queued',
      relatedEntity: { type: 'role', id: role._id },
    });

    await enqueueJob('generate-questions', {
      entityId: role._id.toString(),
      roleId: role._id.toString(),
      jobId: job._id.toString(),
      userId: req.userId.toString(),
      candidateIds: candidates.map((c) => c._id.toString()),
    });

    res.status(202).json({
      jobId: job._id,
      message: `Generating interview questions for ${candidates.length} candidates.`,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate questions' });
  }
});

/**
 * POST /api/roles/:id/score-candidates
 * Trigger scoring for all candidates with processed resumes
 */
router.post('/:id/score-candidates', async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, userId: req.userId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const candidates = await Candidate.find({
      roleId: req.params.id,
      'resume.processingStatus': 'done',
    });

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No candidates ready for scoring.' });
    }

    // Credit check is handled by middleware (applied in server.js for this route)

    const job = await Job.create({
      userId: req.userId,
      type: 'score-candidates',
      status: 'queued',
      relatedEntity: { type: 'role', id: role._id },
    });

    await enqueueJob('score-candidates', {
      entityId: role._id.toString(),
      roleId: role._id.toString(),
      jobId: job._id.toString(),
      userId: req.userId.toString(),
      candidateIds: candidates.map((c) => c._id.toString()),
    });

    res.status(202).json({
      jobId: job._id,
      message: `Scoring ${candidates.length} candidates.`,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start scoring' });
  }
});

/**
 * GET /api/roles/:id/results
 * Get ranked candidate results
 */
router.get('/:id/results', async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const candidates = await Candidate.find({ roleId: req.params.id })
      .sort({ 'scores.overallScore': -1 })
      .lean();

    const results = candidates.map((c) => ({
      _id: c._id,
      name: c.name,
      email: c.email,
      overallScore: c.scores?.overallScore || 0,
      label: c.scores?.label || '',
      categories: (c.scores?.categories || []).map((cat) => ({
        name: cat.categoryName,
        score: cat.score,
      })),
      resumeProcessed: c.resume?.processingStatus === 'done',
      interviewProcessed: c.interview?.processingStatus === 'done',
      scoringComplete: c.scores?.processingStatus === 'done',
      executiveSummary: c.scores?.executiveSummary || '',
    }));

    res.json({
      role: { _id: role._id, title: role.title },
      candidates: results,
      totalCandidates: results.length,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

/**
 * GET /api/roles/:id/questions
 * Get generated interview questions for a role
 */
router.get('/:id/questions', async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const candidates = await Candidate.find({
      roleId: req.params.id,
      'interviewQuestions.processingStatus': 'done',
    }).lean();

    res.json({
      role: { _id: role._id, title: role.title },
      candidates: candidates.map((c) => ({
        _id: c._id,
        name: c.name,
        questions: c.interviewQuestions,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

module.exports = router;
