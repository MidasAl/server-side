const mongoose = require('mongoose');

const reimbursementRequestSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    adminEmail: { type: String, required: true },
    reimbursementDetails: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true },
    receiptPath: { type: String, required: true },
    s3Urls: [{ type: String }],
    status: { type: String, enum: ['Approved', 'Rejected', 'Pending'], required: true },
    feedback: { type: String, required: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("ReimbursementRequest", reimbursementRequestSchema);