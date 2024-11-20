const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const logger = require('../config/logger');
require('dotenv').config();

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'midasbucket';
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';

const s3_client = new AWS.S3({
    region: AWS_REGION,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
});

async function uploadToS3(file_path, original_filename, decision, admin_email) {
    try {
        const target_repo = admin_email.replace('@', '').replace(/\./g, '');
        const [name, ext] = path.basename(original_filename).split('.');
        const current_datetime = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '_');
        const new_filename = `${name}_${current_datetime}.${ext}`;
        const object_name = `Reimbursement/${target_repo}/${decision.toUpperCase()}/${new_filename}`;

        await s3_client.upload({
            Bucket: AWS_S3_BUCKET_NAME,
            Key: object_name,
            Body: fs.createReadStream(file_path)
        }).promise();

        const s3_url = `https://${AWS_S3_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${object_name}`;
        logger.info(`Uploaded ${file_path} to ${s3_url}`);
        return s3_url;
    } catch (e) {
        if (e.code === 'ENOENT') {
            throw new Error(`The file ${file_path} was not found.`);
        } else if (e.code === 'CredentialsError') {
            throw new Error('AWS credentials not available.');
        } else {
            logger.error(`Client error: ${e.message}`);
            throw new Error('Error uploading file to S3.');
        }
    }
}

module.exports = {
    uploadToS3
};