const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET_NAME || 'talentscore-files';

/**
 * Generate a presigned URL for uploading a file to S3
 * @param {string} category - 'resumes' | 'audio' | 'video' | 'transcripts' | 'voice-priorities'
 * @param {string} userId
 * @param {string} roleId
 * @param {string} fileName
 * @param {string} contentType
 * @returns {{ uploadUrl: string, s3Key: string }}
 */
const generatePresignedUploadUrl = async (category, userId, roleId, fileName, contentType) => {
  const ext = fileName.split('.').pop();
  const uniqueName = `${uuidv4()}.${ext}`;
  const s3Key = `${category}/${userId}/${roleId}/${uniqueName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    ContentType: contentType,
    ServerSideEncryption: 'AES256',
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 min
  return { uploadUrl, s3Key };
};

/**
 * Generate a presigned URL for downloading a file from S3
 * @param {string} s3Key
 * @returns {string} downloadUrl
 */
const generatePresignedDownloadUrl = async (s3Key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
};

module.exports = { s3Client, generatePresignedUploadUrl, generatePresignedDownloadUrl };
