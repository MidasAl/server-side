const fs = require('fs').promises;
const path = require('path');
const unzipper = require('unzipper');
const pdfParse = require('pdf-parse');
const docx4js = require('docx4js');

const ALLOWED_EXTENSIONS = ['.docx', '.pdf', '.jpg', '.jpeg', '.png', '.zip'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

async function encodeImage(imagePath) {
  try {
    const imageBuffer = await fs.readFile(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error(`Error encoding image: ${error.message}`);
    throw error;
  }
}

async function extractTextFromPDF(pdfPath) {
  try {
    const buffer = await fs.readFile(pdfPath);
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
  } catch (error) {
    console.error(`Error extracting text from PDF: ${error.message}`);
    throw error;
  }
}

async function extractTextFromDocx(docxPath) {
  try {
    const doc = await docx4js.load(docxPath);
    const paragraphs = doc.getFullText();
    const tables = doc.getTablesText();
    return `${paragraphs}\n\n=== Tables ===\n\n${tables}`;
  } catch (error) {
    console.error(`Error extracting text from DOCX: ${error.message}`);
    throw error;
  }
}

async function processSingleFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext}`);
  }

  if (ext === '.pdf') {
    return { content: await extractTextFromPDF(filePath), isImage: false };
  } else if (ext === '.docx') {
    return { content: await extractTextFromDocx(filePath), isImage: false };
  } else if (IMAGE_EXTENSIONS.includes(ext)) {
    return { content: await encodeImage(filePath), isImage: true };
  } else {
    throw new Error(`Unsupported file type for processing: ${ext}`);
  }
}

async function processZip(zipPath, outputDir) {
  const results = [];
  await unzipper.Open.file(zipPath).then(async (dir) => {
    for (const file of dir.files) {
      const fullPath = path.join(outputDir, file.path);
      if (file.type === 'File') {
        await file.stream().pipe(fs.createWriteStream(fullPath));
        results.push(await processSingleFile(fullPath));
      }
    }
  });
  return results;
}

module.exports = {
  processSingleFile,
  processZip,
};
