const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const User = require('../models/user');
const Group = require('../models/group');
const InviteCode = require('../models/inviteCode');
const logger = require('../config/logger');

// Join group endpoint
router.post("/join", isAuthenticated, async (req, res) => {
    const { group_code } = req.body;

    if (!group_code) {
        return res.status(400).json({ message: "Group code is required." });
    }

    try {
        const code = await InviteCode.findOne({ 
            code: group_code, 
            used: false, 
            expiresAt: { $gt: new Date() } 
        });
        
        if (!code) {
            return res.status(400).json({ message: "Invalid or expired group code." });
        }

        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        // Find the group associated with the invite code
        const group = await Group.findOne({ inviteCode: group_code });
        if (!group) {
            return res.status(404).json({ message: "Group not found." });
        }

        // Check if user is already in the group
        if (user.groups.includes(group._id)) {
            return res.status(400).json({ message: "User is already a member of this group." });
        }

        // Add the group to user's groups array
        user.groups.push(group._id);

        // Set this group as active only if the user doesn't have an active group
        if (!user.activeGroup) {
            user.activeGroup = group._id;
        }

        await user.save();

        // Update group member count
        group.memberCount += 1;
        group.lastActive = new Date();
        await group.save();

        // Mark the invite code as used
        code.used = true;
        code.usedBy = user._id;
        await code.save();

        res.json({ message: "Successfully joined the group." });
    } catch (error) {
        logger.error("Error joining group:", error);
        res.status(500).json({ message: "Error joining group", error });
    }
});

// Switch active group endpoint
router.post("/switch-active", isAuthenticated, async (req, res) => {
    const { groupId } = req.body;

    if (!groupId) {
        return res.status(400).json({ message: "Group ID is required." });
    }

    try {
        const user = await User.findById(req.session.userId);

        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        if (!user.groups.includes(groupId)) {
            return res.status(400).json({ message: "User is not a member of this group." });
        }

        user.activeGroup = groupId;
        await user.save();

        res.json({ message: "Active group switched successfully." });
    } catch (error) {
        logger.error("Error switching active group:", error);
        res.status(500).json({ message: "Error switching active group", error });
    }
});

// Get user's groups endpoint
router.get("/", isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId)
            .populate('groups')
            .populate('activeGroup');
            
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Get all groups the user belongs to
        const groups = user.groups;

        const groupsData = await Promise.all(groups.map(async (group) => {
            const memberCount = await User.countDocuments({ groups: group._id });
            return {
                id: group._id,
                name: group.name,
                company: group.company,
                adminEmail: group.adminEmail,
                inviteCode: group.inviteCode,
                isPrivate: group.isPrivate,
                lastActive: group.lastActive,
                memberCount: memberCount,
                isActive: user.activeGroup && user.activeGroup.equals(group._id),
            };
        }));

        res.json(groupsData);
    } catch (error) {
        logger.error("Error fetching groups:", error);
        res.status(500).json({ message: "Error fetching groups", error });
    }
});

module.exports = router;