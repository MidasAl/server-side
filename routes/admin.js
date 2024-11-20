const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const User = require('../models/user');
const Group = require('../models/group');
const InviteCode = require('../models/inviteCode');
const ReimbursementRequest = require('../models/reimbursement');
const logger = require('../config/logger');

// Generate invite code endpoint
router.post("/generate-code", isAuthenticated, async (req, res) => {
    try {
        // First, verify the user is an admin
        const user = await User.findById(req.session.userId);

        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Generate a random 8-character code
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        
        // Check if code already exists
        const existingCode = await InviteCode.findOne({ code });
        if (existingCode) {
            return res.status(400).json({ message: 'Please try again - code already exists' });
        }

        // Create a new invite code
        const inviteCode = new InviteCode({
            code,
            createdBy: user._id,
            used: false,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
        });
        await inviteCode.save();

        // Create a new group
        const group = new Group({
            name: user.company,
            company: user.company,
            inviteCode: code,
            adminEmail: user.email,
            memberCount: 1,
            lastActive: new Date()
        });
        await group.save();

        res.json({ 
            code,
            message: 'Invite code generated successfully'
        });

    } catch (error) {
        logger.error("Error generating code:", error);
        res.status(500).json({ 
            message: "Error generating invite code", 
            error: error.message 
        });
    }
});

// Get users for admin
router.get("/users", isAuthenticated, async (req, res) => {
    try {
        const admin = await User.findById(req.session.userId);
        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Get all users who have joined groups created by this admin
        const adminGroups = await Group.find({ adminEmail: admin.email });
        const adminGroupIds = adminGroups.map(group => group._id);

        const users = await User.find({ groups: { $in: adminGroupIds } })
            .select('-password');

        res.json({ 
            users: users.map(user => ({
                id: user._id,
                name: user.name,
                email: user.email,
                company: user.company,
                groups: user.groups,
                activeGroup: user.activeGroup,
                createdAt: user.createdAt
            }))
        });
    } catch (error) {
        logger.error("Error fetching users:", error);
        res.status(500).json({ message: "Error fetching users", error });
    }
});

// Admin Dashboard to View Reimbursement Requests
router.get("/reimbursements", isAuthenticated, async (req, res) => {
    try {
        const admin = await User.findById(req.session.userId);
        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Find all reimbursement requests associated with this admin
        const reimbursements = await ReimbursementRequest.find({ 
            adminEmail: admin.email 
        }).sort({ createdAt: -1 });

        res.status(200).json({ reimbursements });
    } catch (error) {
        logger.error("Error fetching reimbursements:", error);
        res.status(500).json({ message: "Error fetching reimbursements", error });
    }
});

// Admin Info Endpoint
router.get("/info", isAuthenticated, async (req, res) => {
    try {
        const admin = await User.findById(req.session.userId);
        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ message: 'Not authorized' });
        }

        res.json({ 
            company: admin.company
        });
    } catch (error) {
        logger.error("Error fetching admin info:", error);
        res.status(500).json({ message: "Error fetching admin info", error });
    }
});

module.exports = router;