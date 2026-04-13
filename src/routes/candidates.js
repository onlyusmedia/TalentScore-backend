const express = require('express');
const Candidate = require('../models/Candidate');
const Role = require('../models/Role');
const Job = require('../models/Job');
const { enqueueJob } = require('../services/queue');

const router = express.Router();

/**
 * POST /api/roles/:roleId/candidates
 * Add a candidate (after resume uploaded to S3)
 */
router.post('/roles/:roleId/candidates', async (req, res) => {
  try {
    const { s3Key, fileName, fileType } = req.body;

    if (!s3Key || !fileName) {
      return res.status(400).json({ error: 's3Key and fileName are required' });
    }

    const role = await Role.findOne({ _id: req.params.roleId, userId: req.userId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const candidate = new Candidate({
      roleId: role._id,
      userId: req.userId,
      resume: {
        s3Key,
        fileName,
        fileType: fileType || fileName.split('.').pop().toLowerCase(),
        processingStatus: 'pending',
      },
    });
    await candidate.save();

    // Update candidate count
    await Role.findByIdAndUpdate(role._id, { $inc: { candidateCount: 1 } });

    // Create job and enqueue resume parsing
    const job = await Job.create({
      userId: req.userId,
      type: 'resume-parse',
      status: 'queued',
      relatedEntity: { type: 'candidate', id: candidate._id },
    });

    await enqueueJob('resume-parse', {
      entityId: candidate._id.toString(),
      candidateId: candidate._id.toString(),
      roleId: role._id.toString(),
      jobId: job._id.toString(),
      userId: req.userId.toString(),
      s3Key,
      fileType: candidate.resume.fileType,
    });

    res.status(202).json({
      candidate: candidate.toObject(),
      jobId: job._id,
      message: 'Resume uploaded. AI is analyzing it now.',
    });
  } catch (error) {
    console.error('[Candidates] Create error:', error.message);
    res.status(500).json({ error: 'Failed to add candidate' });
  }
});

/**
 * GET /api/roles/:roleId/candidates
 * List all candidates for a role
 */
router.get('/roles/:roleId/candidates', async (req, res) => {
  try {
    const role = await Role.findOne({ _id: req.params.roleId, userId: req.userId });
    if (!role) {
      return res.status(404).json({ error: 'Role not found' });
    }

    const candidates = await Candidate.find({ roleId: req.params.roleId })
      .select('-resume.extractedText -resume.embedding -interview.transcriptRaw')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ candidates });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch candidates' });
  }
});

/**
 * GET /api/candidates/:id
 * Get full candidate detail (for detail page)
 */
router.get('/candidates/:id', async (req, res) => {
  try {
    const candidate = await Candidate.findOne({
      _id: req.params.id,
      userId: req.userId,
    }).lean();

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    res.json({ candidate });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch candidate' });
  }
});

/**
 * DELETE /api/candidates/:id
 * Remove a candidate
 */
router.delete('/candidates/:id', async (req, res) => {
  try {
    const candidate = await Candidate.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    // Decrement candidate count
    await Role.findByIdAndUpdate(candidate.roleId, { $inc: { candidateCount: -1 } });

    res.json({ message: 'Candidate removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete candidate' });
  }
});

/**
 * POST /api/candidates/:id/interview
 * Upload interview data (audio/video S3 key or transcript)
 */
router.post('/candidates/:id/interview', async (req, res) => {
  try {
    const { audioS3Key, videoS3Key, transcript } = req.body;

    if (!audioS3Key && !videoS3Key && !transcript) {
      return res.status(400).json({ error: 'Provide an audio file, video file, or transcript' });
    }

    const candidate = await Candidate.findOne({
      _id: req.params.id,
      userId: req.userId,
    });

    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }

    // If transcript is provided directly, save it
    if (transcript && !audioS3Key) {
      candidate.interview.transcriptRaw = transcript;
      candidate.interview.processingStatus = 'pending';
      await candidate.save();

      // Queue structuring (Q&A format) even for text transcripts
      const job = await Job.create({
        userId: req.userId,
        type: 'transcribe-interview',
        status: 'queued',
        relatedEntity: { type: 'candidate', id: candidate._id },
      });

      await enqueueJob('transcribe-interview', {
        entityId: candidate._id.toString(),
        candidateId: candidate._id.toString(),
        roleId: candidate.roleId.toString(),
        jobId: job._id.toString(),
        userId: req.userId.toString(),
        hasAudio: false,
        transcript,
      });

      return res.status(202).json({
        jobId: job._id,
        message: 'Transcript received. Structuring into Q&A format.',
      });
    }

    // Audio/video upload
    if (audioS3Key) candidate.interview.audioS3Key = audioS3Key;
    if (videoS3Key) candidate.interview.videoS3Key = videoS3Key;
    candidate.interview.processingStatus = 'pending';
    await candidate.save();

    const job = await Job.create({
      userId: req.userId,
      type: 'transcribe-interview',
      status: 'queued',
      relatedEntity: { type: 'candidate', id: candidate._id },
    });

    await enqueueJob('transcribe-interview', {
      entityId: candidate._id.toString(),
      candidateId: candidate._id.toString(),
      roleId: candidate.roleId.toString(),
      jobId: job._id.toString(),
      userId: req.userId.toString(),
      hasAudio: true,
      audioS3Key,
    });

    res.status(202).json({
      jobId: job._id,
      message: 'Interview uploaded. Transcribing and structuring now.',
    });
  } catch (error) {
    console.error('[Interview] Upload error:', error.message);
    res.status(500).json({ error: 'Failed to process interview' });
  }
});

module.exports = router;
