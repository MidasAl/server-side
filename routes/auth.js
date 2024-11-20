const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { isAuthenticated } = require('../middleware/auth');
const User = require('../models/user');
const logger = require('../config/logger');

// Register endpoint
router.post("/register", async (req, res) => {
    const { name, company, email, password, confirmPassword, isAdmin } = req.body;

    // Validate required fields
    if (!name || !company || !email || !password || !confirmPassword) {
        return res.status(400).json({ message: "All fields are required." });
    }

    // Check if passwords match
    if (password !== confirmPassword) {
        return res.status(400).json({ message: "Passwords do not match." });
    }

    // Check password length
    if (password.length < 10) {
        return res.status(400).json({ message: "Password must be at least 10 characters long." });
    }

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const role = isAdmin ? 'admin' : 'user';

        const user = new User({
            name,
            company,
            email,
            password: hashedPassword,
            role: role,
            groups: [],
            activeGroup: null,
        });
        await user.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        logger.error("Error registering user:", error);
        res.status(400).json({ message: "Error registering user", error });
    }
});

// Login endpoint
router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: "User not found" });

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) return res.status(400).json({ message: "Incorrect password" });

        req.session.userId = user._id;
        res.json({
            message: "Login successful!",
            user: {
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });
    } catch (error) {
        logger.error("Error logging in:", error);
        res.status(500).json({ message: "Error logging in", error });
    }
});

// Get profile endpoint
router.get("/profile", isAuthenticated, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).populate('activeGroup');
        if (!user) return res.status(404).json({ message: "User not found" });
        
        let adminEmail = null;
        if (user.activeGroup) {
            adminEmail = user.activeGroup.adminEmail;
        }

        res.json({
            name: user.name,
            email: user.email,
            company: user.company,
            role: user.role,
            admin_email: adminEmail
        });
    } catch (error) {
        logger.error("Error fetching profile:", error);
        res.status(500).json({ message: "Error fetching profile", error });
    }
});

// Logout endpoint
router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error("Error logging out:", err);
            return res.status(500).json({ message: "Failed to log out" });
        }
        res.clearCookie("connect.sid");
        res.json({ message: "Logged out successfully" });
    });
});

module.exports = router;