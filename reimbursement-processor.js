const fs = require('fs');
const path = require('path');
const os = require('os');
const { Configuration, OpenAIApi } = require('openai');
const AWS = require('aws-sdk');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const AdmZip = require('adm-zip');
const dotenv = require('dotenv');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ]
});

dotenv.config();

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY
});

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'midasbucket';
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';

const client = new OpenAIApi(configuration);

const s3_client = new AWS.S3({
    region: AWS_REGION,
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
});

class MultiFileProcessor {
    static ALLOWED_EXTENSIONS = new Set(['.docx', '.pdf', '.jpg', '.jpeg', '.png', '.zip', '.txt']);
    static IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
    
    static getFileExtension(filename) {
        return path.extname(filename).toLowerCase();
    }
    
    static encodeImage(image_path) {
        try {
            const image_file = fs.readFileSync(image_path);
            return image_file.toString('base64');
        } catch (e) {
            logger.error(`Error encoding image: ${e.message}`);
            throw new Error(`Error encoding image: ${e.message}`);
        }
    }

    static async extractTextFromPdf(pdf_path) {
        try {
            const file = fs.readFileSync(pdf_path);
            const reader = await pdf(file);
            const content = [];
            
            const text = reader.text;
            const lines = text.split('\n');
            const formatted_lines = [];
            
            for (const line of lines) {
                if (line.includes('\t') || line.includes('    ')) {
                    let items = line.split('\t')
                        .map(item => item.trim())
                        .filter(item => item.trim());
                    
                    if (items.length === 0) {
                        items = line.split('    ')
                            .map(item => item.trim())
                            .filter(item => item.trim());
                    }
                    
                    if (items.length > 0) {
                        formatted_lines.push(items.join('\t'));
                    }
                } else {
                    formatted_lines.push(line);
                }
            }
            
            return formatted_lines.join('\n');
        } catch (e) {
            logger.error(`Error extracting text from PDF: ${e.message}`);
            throw new Error(`Error extracting text from PDF: ${e.message}`);
        }
    }

    static async extractTextFromDocx(file_path) {
        try {
            const file = fs.readFileSync(file_path);
            const result = await mammoth.extractRawText({ buffer: file });
            const content = [];
            
            const doc = result.value;
            const paragraphs = doc.split('\n');
            
            for (const para of paragraphs) {
                if (para.trim()) {
                    content.push(para.trim());
                }
            }
            
            return content.join('\n\n');
        } catch (e) {
            logger.error(`Error extracting text from DOCX: ${e.message}`);
            throw new Error(`Error extracting text from DOCX: ${e.message}`);
        }
    }

    static async saveUploadFile(upload_file) {
        try {
            const tmp_file_path = path.join(os.tmpdir(), path.basename(upload_file.originalname));
            await fs.promises.writeFile(tmp_file_path, upload_file.buffer);
            return tmp_file_path;
        } catch (e) {
            logger.error(`Error saving uploaded file: ${e.message}`);
            throw new Error(`Error saving uploaded file: ${e.message}`);
        }
    }

    static async extractPolicies(adminEmail) {
        try {
            const adminRepo = adminEmail.replace('@', '').replace(/\./g, '');
            const s3Prefix = `Reimbursement/${adminRepo}/policies/`;
            
            const objects = await s3_client.listObjects({
                Bucket: AWS_S3_BUCKET_NAME,
                Prefix: s3Prefix
            }).promise();

            if (!objects.Contents || objects.Contents.length === 0) {
                return null;
            }

            let policiesText = '';
            
            for (const object of objects.Contents) {
                if (object.Key.endsWith('ACTIVE')) continue;
                
                const file = await s3_client.getObject({
                    Bucket: AWS_S3_BUCKET_NAME,
                    Key: object.Key
                }).promise();

                const ext = path.extname(object.Key).toLowerCase();
                
                if (ext === '.txt') {
                    policiesText += file.Body.toString('utf-8') + '\n';
                } else if (ext === '.docx') {
                    policiesText += await this.extractTextFromDocx(file.Body) + '\n';
                } else if (ext === '.pdf') {
                    policiesText += await this.extractTextFromPdf(file.Body) + '\n';
                }
            }
            
            return policiesText.trim() || null;
        } catch (e) {
            logger.error(`Error extracting policies: ${e.message}`);
            return null;
        }
    }

    static async processZip(zip_path) {
        const processed_files = [];
        try {
            const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
            const zip_ref = new AdmZip(zip_path);
            
            zip_ref.extractAllTo(tmp_dir, true);
            
            const processDirectory = async (dir) => {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const file_path = path.join(dir, file);
                    const stats = fs.statSync(file_path);
                    
                    if (stats.isDirectory()) {
                        await processDirectory(file_path);
                    } else {
                        const ext = this.getFileExtension(file);
                        
                        if (this.ALLOWED_EXTENSIONS.has(ext) && ext !== '.zip') {
                            try {
                                const processed_content = await this.processSingleFile(file_path);
                                processed_files.push(processed_content);
                            } catch (e) {
                                logger.error(`Error processing file ${file} in zip: ${e.message}`);
                                continue;
                            }
                        }
                    }
                }
            };

            await processDirectory(tmp_dir);
            fs.rmSync(tmp_dir, { recursive: true });
        } catch (e) {
            logger.error(`Error processing zip file: ${e.message}`);
            throw new Error(`Error processing zip file: ${e.message}`);
        }
        
        return processed_files;
    }

    static async processSingleFile(file_path) {
        const ext = this.getFileExtension(file_path);
        
        try {
            if (ext === '.docx') {
                return {
                    content: await this.extractTextFromDocx(file_path),
                    is_image: false
                };
            } else if (ext === '.pdf') {
                return {
                    content: await this.extractTextFromPdf(file_path),
                    is_image: false
                };
            } else if (ext === '.txt') {
                return {
                    content: fs.readFileSync(file_path, 'utf-8'),
                    is_image: false
                };
            } else if (this.IMAGE_EXTENSIONS.has(ext)) {
                return {
                    content: this.encodeImage(file_path),
                    is_image: true
                };
            } else {
                throw new Error(`Unsupported file type: ${ext}`);
            }
        } catch (e) {
            logger.error(`Error processing file ${file_path}: ${e.message}`);
            throw new Error(`Error processing file ${file_path}: ${e.message}`);
        }
    }
}

async function analyzeWithGpt4o(content, is_image = false, policies = '') {
    const maxRetries = 3;
    const baseDelay = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const baselinePolicy = `
                Valid Expense Categories: Approve only expenses that fall under approved categories such as travel, meals, office supplies, or training programs. Decline others.
                Receipt Requirement: Approve only if a valid receipt is provided with the claim.
                Spending Limits:
                    Meals: Up to $50 per day
                    Travel (flight): Up to $500 per flight
                    Office Supplies: Up to $200 per item
                Submission Deadline: Expenses must be submitted within 30 days of the transaction date.
                Policy Exceptions: If the claim exceeds limits or falls outside the categories, check for a valid manager's approval attached as additional documentation.
            `;

            const currentDate = new Date().toISOString();
            const policyText = policies || baselinePolicy;

            const messages = [
                {
                    role: "system",
                    content: (
                        "You are an assistant helping with reimbursement requests. " +
                        "Analyze the receipt image and decide whether to 'Approve' or 'Reject' the request based on the following policies:\n\n" +
                        policyText + "\n\n" +
                        "Current date: " + currentDate + "\n\n" +
                        "Please respond in the following format:\n\n" +
                        "Decision: [Approve/Reject]\n" +
                        "Feedback: [Your explanation here]\n\n" +
                        "Please avoid using ambiguous language that might put the decision in doubt."
                    )
                },
                {
                    role: "user",
                    content: is_image 
                        ? `Please analyze this receipt image in base64 format:\n\n${content}`
                        : `Here is the document content:\n\n${content}`
                }
            ];
            
            const response = await client.createChatCompletion({
                model: "gpt-4o-mini",
                messages: messages
            });
            
            const analysis = response.data.choices[0].message.content;
            const lines = analysis.trim().split('\n');
            let decision = null;
            const feedback_lines = [];

            for (const line of lines) {
                if (line.toLowerCase().startsWith("decision:")) {
                    decision = line.substring("Decision:".length).trim();
                } else if (line.toLowerCase().startsWith("feedback:")) {
                    feedback_lines.push(line.substring("Feedback:".length).trim());
                } else {
                    feedback_lines.push(line.trim());
                }
            }

            if (!['Approve', 'Reject'].includes(decision)) {
                decision = 'Rejected';
            }

            return {
                decision: decision,
                feedback: feedback_lines.join('\n')
            };
        } catch (e) {
            if (e.response?.status === 429 && attempt < maxRetries - 1) {
                const delay = baseDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw e;
        }
    }
    throw new Error('Max retries exceeded for OpenAI API');
}

function sanitizeFilename(filename) {
    filename = path.basename(filename);
    return filename.replace(/[^\w\.-]/g, '_');
}

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

async function requestReimbursement(data) {
    try {
        const { role, name, email, admin_email, reimbursement_details, files } = data;

        if (!role || role.toLowerCase() !== 'user') {
            throw new Error("Role must be 'user'.");
        }
        
        const processor = new MultiFileProcessor();
        const temp_files = [];
        const all_content = [];
        const s3_urls = [];
        
        try {
            // Get policies for this admin
            const policies = await processor.constructor.extractPolicies(admin_email);
            
            for (const file of files) {
                const ext = processor.constructor.getFileExtension(file.originalname);
                if (!processor.constructor.ALLOWED_EXTENSIONS.has(ext)) {
                    throw new Error(`Unsupported file type: ${ext}`);
                }
                
                const temp_file_path = await processor.constructor.saveUploadFile(file);
                const original_filename = sanitizeFilename(file.originalname);
                temp_files.push({ path: temp_file_path, original_filename });
                
                if (ext === '.zip') {
                    const zip_contents = await processor.constructor.processZip(temp_file_path);
                    all_content.push(...zip_contents);
                } else {
                    const processed_content = await processor.constructor.processSingleFile(temp_file_path);
                    all_content.push(processed_content);
                }
            }
            
            let combined_feedback = "";
            const decisions = [];
            
            for (const content_item of all_content) {
                const analysis_result = await analyzeWithGpt4o(
                    content_item.content,
                    content_item.is_image,
                    policies
                );
                const decision = analysis_result.decision;
                const feedback = analysis_result.feedback;

                combined_feedback += `${feedback}\n\n`;
                decisions.push(decision);
            }
            
            const final_decision = decisions.every(dec => dec.toLowerCase() === 'approve')
                ? 'Approved'
                : 'Rejected';
            
            for (const { path: temp_file, original_filename } of temp_files) {
                const s3_url = await uploadToS3(temp_file, original_filename, final_decision, admin_email);
                s3_urls.push(s3_url);
            }
            
            return {
                status: final_decision,
                feedback: combined_feedback.trim(),
                processed_files: all_content.length,
                uploaded_files: s3_urls
            };
                
        } finally {
            // Clean up temp files
            for (const { path } of temp_files) {
                if (fs.existsSync(path)) {
                    fs.unlinkSync(path);
                }
            }
        }
    } catch (e) {
        logger.error(`Error in request_reimbursement: ${e.message}`);
        throw new Error(`Error processing request: ${e.message}`);
    }
}

module.exports = { requestReimbursement };