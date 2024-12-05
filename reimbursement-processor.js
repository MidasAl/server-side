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

function sanitizeFilename(filename) {
  filename = path.basename(filename);
  return filename.replace(/[^\w\.-]/g, '_');
}

async function saveUploadFile(upload_file) {
  try {
    const tmp_file_path = path.join(os.tmpdir(), sanitizeFilename(upload_file.originalname));

    if (upload_file.buffer) {
      // If buffer exists, write it to tmp_file_path
      await fs.promises.writeFile(tmp_file_path, upload_file.buffer);
    } else if (upload_file.path) {
      // If buffer doesn't exist but path does, copy the file
      await fs.promises.copyFile(upload_file.path, tmp_file_path);
    } else {
      throw new Error('File buffer and path are undefined.');
    }

    return tmp_file_path;
  } catch (e) {
    logger.error(`Error saving uploaded file: ${e.message}`);
    throw new Error(`Error saving uploaded file: ${e.message}`);
  }
}

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

async function analyzeWithGpt4o(reimbursement_details, content, is_image = false, userPolicies) {
  try {
    const currentDate = new Date().toISOString();
    const policyText = `
Valid Expense Category: ${userPolicies.category}
Maximum Amount Allowed: $${userPolicies.amount}
Request Limits: Maximum ${userPolicies.frequency.times} requests every ${userPolicies.frequency.days} days
`;

    const messages = [
      {
        role: "system",
        content: (
          "You are an assistant helping with reimbursement requests. " +
          "Analyze the receipt and decide whether to 'Approve' or 'Reject' the request based on the following policies:\n\n" +
          policyText + "\n\n" +
          "Current date: " + currentDate + "\n\n" +
          "Approve ONLY if:\n" +
          "1. The expense category matches the allowed category\n" +
          "2. The amount is within the maximum allowed\n" +
          "\nRespond in the format below, using plain text only (no bold, no LaTeX, no special formatting):\n" +
          "Decision: [Approve/Reject]\n" +
          "Category: [Extracted category]\n" +
          "Amount: [Extracted amount as number]\n" +
          "Feedback: [Your explanation here]\n" +
          "Please avoid using ambiguous language that might put the decision in doubt."
        )
      },
      {
        role: "user",
        content: is_image
          ? `These are the reimbursement details: ${String(reimbursement_details)}. Please analyze this receipt image in base64 format:\n\n${content}`
          : `These are the reimbursement details: ${String(reimbursement_details)}. Here is the document content:\n\n${content}`
      }
    ];

    const response = await client.createChatCompletion({
      model: "gpt-4", // Ensure you're using a valid model name
      messages: messages
    });

    const analysis = response.data.choices[0].message.content;
    const lines = analysis.trim().split('\n');
    let decision = null;
    let category = null;
    let amount = null;
    const feedback_lines = [];

    for (const line of lines) {
      if (line.toLowerCase().startsWith("decision:")) {
        decision = line.substring("Decision:".length).trim();
      } else if (line.toLowerCase().startsWith("category:")) {
        category = line.substring("Category:".length).trim();
      } else if (line.toLowerCase().startsWith("amount:")) {
        const amountStr = line.substring("Amount:".length).trim().replace('$', '');
        amount = parseFloat(amountStr) || 0;
      } else if (line.toLowerCase().startsWith("feedback:")) {
        feedback_lines.push(line.substring("Feedback:".length).trim());
      } else {
        feedback_lines.push(line.trim());
      }
    }

    if (!['Approve', 'Reject'].includes(decision)) {
      decision = 'Reject';
    }

    // Map 'Approve'/'Reject' to 'Approved'/'Rejected'
    if (decision.toLowerCase() === 'approve') {
      decision = 'Approved';
    } else {
      decision = 'Rejected';
    }

    return {
      decision: decision,
      category: category || userPolicies.category,
      amount: amount || 0,
      feedback: feedback_lines.join('\n')
    };

  } catch (e) {
    console.error(`Error in GPT analysis: ${e.message}`);
    throw new Error(`Error analyzing receipt: ${e.message}`);
  }
}

async function extractPolicyDetails(policyText) {
    try {
      console.log('Policy Text:', policyText); // Log the policy text received
  
      const response = await client.createChatCompletion({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `
  You are an assistant that extracts policy details from text documents.
  
  Please extract the following details from the provided policy text:
  
  - Category: The expense category allowed.
  - Amount: The maximum amount allowed (in dollars).
  - Frequency: The maximum number of requests allowed and the number of days over which this limit applies.
  
  Respond in the following JSON format, do not add any additional text:
  
  {
    "category": "Category Name",
    "amount": AmountInDollars,
    "frequency": {
      "times": NumberOfRequests,
      "days": NumberOfDays
    }
  }
  
  If any information is missing, use the default values:
  
  {
    "category": "Expenses",
    "amount": 500,
    "frequency": {
      "times": 10,
      "days": 7
    }
  }
  `
          },
          {
            role: "user",
            content: policyText
          }
        ]
      });
  
      console.log('OpenAI API response:', response); // Log the entire response object
  
      const llmOutput = response.data.choices[0].message.content;
  
      // Proceed with parsing the LLM output
      const policyData = JSON.parse(llmOutput);
  
      return {
        category: policyData.category || 'Expenses',
        amount: policyData.amount || 500,
        times: policyData.frequency.times || 10,
        days: policyData.frequency.days || 7,
      };
  
    } catch (e) {
      console.error('Error in extractPolicyDetails:', e);
      logger.error(`Error extracting policy details: ${e.message}`);
      throw new Error(`Error extracting policy details: ${e.message}`);
    }
  }
  

async function uploadToS3(file_path, original_filename, decision, admin_email, user_email) {
  try {
    const target_repo = admin_email.replace('@', '').replace(/\./g, '');
    const [name, ext] = path.basename(original_filename).split('.');
    const current_datetime = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '_');
    const user_suffix = user_email.replace('@', '').replace(/\./g, '');
    const new_filename = `${name}_${current_datetime}_${user_suffix}.${ext}`;
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
  MultiFileProcessor,
  analyzeWithGpt4o,
  uploadToS3,
  sanitizeFilename,
  extractPolicyDetails,
  logger,
  saveUploadFile,
};
