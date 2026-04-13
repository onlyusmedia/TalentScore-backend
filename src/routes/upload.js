const express = require('express');
const { generatePresignedUploadUrl, generatePresignedDownloadUrl } = require('../config/s3');

const router = express.Router();

/**
 * POST /api/upload/presigned-url
 * Generate a presigned URL for S3 upload
 */
router.post('/presigned-url', async (req, res) => {
  try {
    const { fileName, contentType, category, roleId } = req.body;

    if (!fileName || !contentType || !category) {
      return res.status(400).json({
        error: 'fileName, contentType, and category are required',
      });
    }

    const validCategories = ['resumes', 'audio', 'video', 'transcripts', 'voice-priorities'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
    }

    const { uploadUrl, s3Key } = await generatePresignedUploadUrl(
      category,
      req.userId.toString(),
      roleId || 'general',
      fileName,
      contentType
    );

    res.json({ uploadUrl, s3Key });
  } catch (error) {
    console.error('[Upload] Presigned URL error:', error.message);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

/**
 * POST /api/upload/presigned-download
 * Generate a presigned URL for S3 download
 */
router.post('/presigned-download', async (req, res) => {
  try {
    const { s3Key } = req.body;
    if (!s3Key) {
      return res.status(400).json({ error: 's3Key is required' });
    }

    const downloadUrl = await generatePresignedDownloadUrl(s3Key);
    res.json({ downloadUrl });
  } catch (error) {
    console.error('[Upload] Download URL error:', error.message);
    res.status(500).json({ error: 'Failed to generate download URL' });
  }
});

module.exports = router;
