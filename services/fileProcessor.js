const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const mammoth = require('mammoth');
const pdf = require('pdf-parse');
const logger = require('../config/logger');

class MultiFileProcessor {
    static ALLOWED_EXTENSIONS = new Set(['.docx', '.pdf', '.jpg', '.jpeg', '.png', '.zip']);
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
                    const items = line.split('\t')
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

module.exports = MultiFileProcessor;