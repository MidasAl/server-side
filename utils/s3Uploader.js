const AWS = require('aws-sdk');
const fs = require('fs').promises;
const path = require('path');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

function sanitizeFilename(filename) {
  return filename.replace(/[^\w\.-]/g, '_');
}

async function uploadToS3(filePath, originalFilename, decision, adminEmail) {
  const folderPath = `Reimbursement/${adminEmail.replace('@', '_')}/${decision}`;
  const newFilename = `${sanitizeFilename(originalFilename)}_${Date.now()}`;

  const params = {
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: `${folderPath}/${newFilename}`,
    Body: await fs.readFile(filePath),
  };

  try {
    const data = await s3.upload(params).promise();
    console.log('Uploaded S3 URL:', data.Location);
    return data.Location;
  } catch (error) {
    console.error('Error uploading to S3:', error.message);
    throw error;
  }
}

module.exports = { uploadToS3, sanitizeFilename };
