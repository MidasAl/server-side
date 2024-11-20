const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: String,
    company: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
    activeGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
});

module.exports = mongoose.model("User", userSchema);