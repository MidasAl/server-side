const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    company: { type: String, required: true },
    inviteCode: { type: String, required: true, unique: true },
    adminEmail: { type: String, required: true },
    isPrivate: { type: Boolean, default: false },
    memberCount: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Group', groupSchema);