const multer = require('multer');
const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadPath)){
            fs.mkdirSync(uploadPath);
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + "-" + file.originalname);
    }
});

const fileFilter = function (req, file, cb) {
    const allowed_types = [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/zip'
    ];
    if (!allowed_types.includes(file.mimetype)) {
        return cb(new Error('Only .docx, .pdf, .jpg, .png and .zip files are allowed!'), false);
    }
    cb(null, true);
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Error handler middleware for Multer
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        logger.error(`Multer error: ${err.message}`);
        return res.status(400).json({ error: err.message });
    } else if (err) {
        logger.error(`Upload error: ${err.message}`);
        return res.status(500).json({ error: err.message });
    }
    next();
};

module.exports = {
    upload,
    handleMulterError
};