const express = require("express");
const bcrypt = require("bcrypt");
const session = require("express-session");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { 
  MultiFileProcessor, 
  analyzeWithGpt4o,
  uploadToS3,
  sanitizeFilename,
  extractPolicyDetails,
  logger,
  saveUploadFile,
} = require('./reimbursement-processor');
const AWS = require("aws-sdk");

const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const AWS_S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'midasbucket';
const AWS_REGION = process.env.AWS_REGION || 'us-east-2';

const s3_client = new AWS.S3({
  region: AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});

require("dotenv").config();

const app = express();

// MongoDB setup
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("Connected to MongoDB"))
.catch((err) => console.log("MongoDB connection error:", err));

// User schema and model
const userSchema = new mongoose.Schema({
  name: String,
  company: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }],
  activeGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  // Modifed policies to be per group
  policies: [{
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
    policy: {
      category: { type: String, default: 'Expenses' },
      amount: { type: Number, default: 500 },
      frequency: {
        times: { type: Number, default: 10 },
        days: { type: Number, default: 7 }
      }
    }
  }],
  members: [{ 
    username: String,
    email: String
  }]
});

const requestTrackingSchema = new mongoose.Schema({
  userEmail: { type: String, required: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  count: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const RequestTracking = mongoose.model('RequestTracking', requestTrackingSchema);

// InviteCode schema and model
const inviteCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  used: { type: Boolean, default: false },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
});

const InviteCode = mongoose.model('InviteCode', inviteCodeSchema);

// ReimbursementRequest schema and model
const reimbursementRequestSchema = new mongoose.Schema({
  userEmail: { type: String, required: true },
  adminEmail: { type: String, required: true },
  reimbursementDetails: { type: String, required: true },
  amount: { type: Number, required: false },
  category: { type: String, required: false },
  receiptPath: { type: String, required: true },
  s3Urls: [{ type: String }],
  status: { type: String, enum: ['Approved', 'Rejected', 'Pending'], required: true },
  feedback: { type: String, required: true },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  createdAt: { type: Date, default: Date.now }
});

const ReimbursementRequest = mongoose.model("ReimbursementRequest", reimbursementRequestSchema);

// Group schema and model
const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  company: { type: String, required: true },
  inviteCode: { type: String, required: true, unique: true },
  adminEmail: { type: String, required: true },
  isPrivate: { type: Boolean, default: false },
  memberCount: { type: Number, default: 0 },
  lastActive: { type: Date, default: Date.now },
});

const Group = mongoose.model('Group', groupSchema);

// Middleware
app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, 'uploads');
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

const upload = multer({ 
  storage: storage,
  fileFilter: function (req, file, cb) {
    const allowed_types = [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/zip',
      'text/plain'
    ];
    if (!allowed_types.includes(file.mimetype)) {
      return cb(new Error('Only .docx, .pdf, .jpg, .png, .txt and .zip files are allowed!'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ message: 'Not authenticated' });
  }
}

// Register endpoint
app.post("/api/register", async (req, res) => {
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

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(400).json({ message: "Email already exists." });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    let role = 'user';
    if (isAdmin) {
      role = 'admin';
    }

    const user = new User({
      name,
      company,
      email,
      password: hashedPassword,
      role: role,
      groups: [],
      activeGroup: null,
      policies: []  // Start with empty policies array
    });
    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(400).json({ message: "Error registering user", error });
  }
});

// Login endpoint
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return res.status(400).json({ message: "Incorrect password" });

    req.session.userId = user._id; // Store user ID in session
    res.json({
      message: "Login successful!",
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Error logging in", error });
  }
});

// Endpoint to get logged-in user profile
app.get("/api/profile", isAuthenticated, async (req, res) => {
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
      admin_email: adminEmail // Include admin_email from the active group
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching profile", error });
  }
});

// Logout endpoint
app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: "Failed to log out" });
    res.clearCookie("connect.sid"); // Clear session cookie
    res.json({ message: "Logged out successfully" });
  });
});

// Generate invite code endpoint
app.post("/api/admin/generate-code", isAuthenticated, async (req, res) => {
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
      adminEmail: user.email, // Added adminEmail here
      memberCount: 1, // Start with 1 for the admin
      lastActive: new Date()
    });
    await group.save();

    if (!user.groups.includes(group._id)) {
      user.groups.push(group._id);
    }
    
    if (!user.activeGroup) {
      user.activeGroup = group._id;
    }
    await user.save();

    res.json({ 
      code,
      message: 'Invite code generated successfully'
    });

  } catch (error) {
    console.error("Error generating code:", error);
    res.status(500).json({ 
      message: "Error generating invite code", 
      error: error.message 
    });
  }
});

// Get users for admin
app.get("/api/admin/users", isAuthenticated, async (req, res) => {
  try {
    const admin = await User.findById(req.session.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Get all users who have joined groups created by this admin
    const adminGroups = await Group.find({ adminEmail: admin.email });
    const adminGroupIds = adminGroups.map(group => group._id);

    const users = await User.find({ groups: { $in: adminGroupIds } }).select('-password');

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
    res.status(500).json({ message: "Error fetching users", error });
  }
});

// Join group endpoint
app.post("/api/join_group", isAuthenticated, async (req, res) => {
  const { group_code } = req.body;

  if (!group_code) {
    return res.status(400).json({ message: "Group code is required." });
  }

  try {
    const code = await InviteCode.findOne({ code: group_code, used: false, expiresAt: { $gt: new Date() } });
    if (!code) {
      return res.status(400).json({ message: "Invalid or expired group code." });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const group = await Group.findOne({ inviteCode: group_code });
    if (!group) {
      return res.status(404).json({ message: "Group not found." });
    }

    if (user.groups.includes(group._id)) {
      return res.status(400).json({ message: "User is already a member of this group." });
    }

    // Add the group to user's groups array
    user.groups.push(group._id);
    if (!user.activeGroup) {
      user.activeGroup = group._id;
    }
    await user.save();

    // Update admin's members array
    const admin = await User.findOne({ email: group.adminEmail });
    if (admin) {
      admin.members.push({
        username: user.name,
        email: user.email
      });
      await admin.save();
    }

    group.memberCount += 1;
    group.lastActive = new Date();
    await group.save();

    code.used = true;
    code.usedBy = user._id;
    await code.save();

    res.json({ message: "Successfully joined the group." });
  } catch (error) {
    res.status(500).json({ message: "Error joining group", error });
  }
});

// Switch active group endpoint
app.post("/api/switch_active_group", isAuthenticated, async (req, res) => {
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
    res.status(500).json({ message: "Error switching active group", error });
  }
});

async function requestReimbursement(data) {
  try {
    const { role, name, email, admin_email, reimbursement_details, files, policies } = data;

    if (!role || role.toLowerCase() !== 'user') {
      throw new Error("Role must be 'user'.");
    }
    
    const processor = new MultiFileProcessor();
    const temp_files = [];
    const all_content = [];
    const s3_urls = [];
    let is_image = false;

    try {
      for (const file of files) {
        const ext = processor.constructor.getFileExtension(file.originalname);
        if (!processor.constructor.ALLOWED_EXTENSIONS.has(ext)) {
          throw new Error(`Unsupported file type: ${ext}`);
        }
        
        const temp_file_path = await saveUploadFile(file);

        const original_filename = sanitizeFilename(file.originalname);
        temp_files.push({ path: temp_file_path, original_filename });
        
        if (ext === '.zip') {
          const zip_contents = await processor.constructor.processZip(temp_file_path);
          all_content.push(...zip_contents);
        } else {
          const processed_content = await processor.constructor.processSingleFile(temp_file_path);
          all_content.push(processed_content);
        }
      }

      let combined_content = '';
      for (const content_item of all_content) {
        if (content_item.is_image) {
          is_image = true;
        }
        combined_content += content_item.content + '\n';
      }

      const policy = policies || {
        category: 'Expenses',
        amount: 500,
        frequency: { times: 10, days: 7 }
      };

      const analysis_result = await analyzeWithGpt4o(
        reimbursement_details,
        combined_content,
        is_image,
        policy
      );

      const final_decision = analysis_result.decision;
      const feedback = analysis_result.feedback;

      for (const { path: temp_file, original_filename } of temp_files) {
        const s3_url = await uploadToS3(temp_file, original_filename, final_decision, admin_email, email);
        s3_urls.push(s3_url);
      }

      return {
        status: final_decision,
        amount: analysis_result.amount || 0,
        category: analysis_result.category || '',
        feedback: feedback.trim(),
        processed_files: all_content.length,
        uploaded_files: s3_urls
      };
          
    } finally {
      for (const { path } of temp_files) {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
        }
      }
    }
  } catch (e) {
    logger.error(`Error in requestReimbursement: ${e.message}`);
    throw new Error(`Error processing request: ${e.message}`);
  }
}

async function forwardReimbursementRequest(data, receiptPath) {
  try {
    console.log('Starting forwardReimbursementRequest with path:', receiptPath);
    console.log('Input data:', data);

    const fileObj = {
      originalname: receiptPath.split('/').pop(),
      buffer: await fs.promises.readFile(receiptPath)
    };

    const requestData = {
      role: data.role,
      name: data.name,
      email: data.email,
      admin_email: data.admin_email,
      reimbursement_details: data.reimbursement_details,
      files: [fileObj],
      policies: data.policies
    };

    console.log('Calling requestReimbursement...');
    const response = await requestReimbursement(requestData);
    
    return response;
  } catch (error) {
    console.error("Error in forwardReimbursementRequest:", {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

app.post("/api/admin/set_policy", isAuthenticated, upload.single('policy'), async (req, res) => {
  try {
    const admin = await User.findById(req.session.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { userEmail } = req.body;
    if (!userEmail) {
      return res.status(400).json({ message: 'User email is required' });
    }

    // Find all groups owned by the admin
    const adminGroups = await Group.find({ adminEmail: admin.email });

    if (adminGroups.length === 0) {
      return res.status(400).json({ message: 'You do not own any groups.' });
    }

    // Find the user
    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Find the common group(s) between the admin and the user
    const commonGroupIds = user.groups.filter(userGroupId =>
      adminGroups.some(adminGroup => adminGroup._id.equals(userGroupId))
    );

    if (commonGroupIds.length === 0) {
      return res.status(400).json({ message: 'User is not a member of any of your groups.' });
    }

    // Use the first common group (or adjust logic if multiple groups are possible)
    const groupId = commonGroupIds[0];

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'Policy file is required' });
    }

    // Process the policy file and extract policy details
    const processor = new MultiFileProcessor();
    let policyText;
    const ext = processor.constructor.getFileExtension(file.originalname);
    const tempFilePath = await saveUploadFile(file);

    if (ext === '.zip') {
      const contents = await processor.constructor.processZip(tempFilePath);
      policyText = contents.map(c => c.content).join('\n');
    } else {
      const processed = await processor.constructor.processSingleFile(tempFilePath);
      policyText = processed.content;
    }

    // Extract policy details using OpenAI API
    const { category, amount, times, days } = await extractPolicyDetails(policyText);

    // Update the user's policies
    const existingPolicyIndex = user.policies.findIndex(p => p.groupId.equals(groupId));

    const newPolicy = {
      groupId: groupId,
      policy: {
        category: category || 'Expenses',
        amount: amount || 500,
        frequency: {
          times: times || 10,
          days: days || 7
        }
      }
    };

    if (existingPolicyIndex >= 0) {
      // Update existing policy
      user.policies[existingPolicyIndex] = newPolicy;
    } else {
      // Add new policy
      user.policies.push(newPolicy);
    }

    await user.save();

    // Clean up temp file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }

    res.json({ 
      message: 'Policy updated successfully',
      policy: newPolicy.policy 
    });

  } catch (error) {
    console.error('Error setting policy:', error);
    res.status(500).json({ message: 'Error setting policy', error: error.message });
  }
});

app.post("/api/request_reimbursement", upload.single('receipt'), isAuthenticated, async (req, res) => {
  console.log("Received request body:", req.body);
  console.log("Received file:", req.file);

  const { reimbursement_details } = req.body;
  const receipt = req.file;
  try {
    const user = await User.findById(req.session.userId).populate('activeGroup');
    if (!user) {
      if (receipt && fs.existsSync(receipt.path)) {
        fs.unlinkSync(receipt.path);
      }
      return res.status(401).json({ 
        status: "Error",
        feedback: "User not authenticated."
      });
    }
  
    if (!user.activeGroup) {
      if (receipt && fs.existsSync(receipt.path)) {
        fs.unlinkSync(receipt.path);
      }
      return res.status(400).json({ 
        status: "Error",
        feedback: "No active group found."
      });
    }

    if (user.role !== 'user') {
      if (receipt && fs.existsSync(receipt.path)) {
        fs.unlinkSync(receipt.path);
      }
      return res.status(403).json({ 
        status: "Error",
        feedback: "Only users with 'user' role can submit reimbursement requests."
      });
    }

    if (!receipt) {
      return res.status(400).json({ 
        status: "Error",
        feedback: "Receipt file is required."
      });
    }

    const admin_email = user.activeGroup ? user.activeGroup.adminEmail : null;
    if (!admin_email) {
      return res.status(400).json({ 
        status: "Error",
        feedback: "No active group or admin email found."
      });
    }

    const userPolicy = user.policies.find(p => p.groupId.equals(user.activeGroup._id));
    const policies = userPolicy ? userPolicy.policy : {
      category: 'Expenses',
      amount: 500,
      frequency: { times: 10, days: 7 }
    };

    let tracking = await RequestTracking.findOne({
      userEmail: user.email,
      groupId: user.activeGroup._id
    });

    if (!tracking) {
      tracking = new RequestTracking({
        userEmail: user.email,
        groupId: user.activeGroup._id
      });
    }

    const now = new Date();
    const daysSinceReset = (now - tracking.lastReset) / (1000 * 60 * 60 * 24);

    if (daysSinceReset >= policies.frequency.days) {
      tracking.count = 0;
      tracking.lastReset = now;
    } else if (tracking.count >= policies.frequency.times) {
      return res.status(400).json({
        status: "Rejected",
        feedback: `Request limit reached. Maximum ${policies.frequency.times} requests every ${policies.frequency.days} days.`
      });
    }

    console.log("Forwarding to reimbursement processor");
    const processedResponse = await forwardReimbursementRequest(
      {
        role: user.role,
        name: user.name,
        email: user.email,
        admin_email,
        reimbursement_details,
        policies: policies
      },
      receipt.path
    );

    if (processedResponse.status === 'Approved') {
      tracking.count += 1;
      await tracking.save();
    }

    let parsedDetails = {};
    try {
      parsedDetails = typeof reimbursement_details === 'string' 
        ? JSON.parse(reimbursement_details) 
        : reimbursement_details;
    } catch (e) {
      console.error("Error parsing reimbursement_details:", e);
    }

    const reimbursementRequest = new ReimbursementRequest({
      userEmail: user.email,
      adminEmail: admin_email,
      reimbursementDetails: reimbursement_details,
      amount: processedResponse.amount,
      category: processedResponse.category,
      receiptPath: receipt.path,
      s3Urls: processedResponse.uploaded_files || [],
      status: processedResponse.status,
      feedback: processedResponse.feedback,
      groupId: user.activeGroup._id,
      createdAt: new Date()
    });
    
    await reimbursementRequest.save();
    console.log("Reimbursement request saved to database");

    res.setHeader('Content-Type', 'application/json');

    const response = {
      status: processedResponse.status,
      feedback: processedResponse.feedback,
      uploaded_files: processedResponse.uploaded_files || [],
      processed_files: processedResponse.processed_files
    };

    console.log("Sending response to frontend:", response);
    return res.status(200).json(response);

  } catch (error) {
    console.error("Error:", error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ 
      status: "Error",
      feedback: error.message || "An error occurred while processing your request."
    });
  } finally {
    if (receipt && fs.existsSync(receipt.path)) {
      if (receipt.path.includes('temp') || receipt.path.includes('tmp')) {
        fs.unlinkSync(receipt.path);
      }
    }
  }
});


// Admin Dashboard to View Reimbursement Requests
app.get("/api/admin/reimbursements", isAuthenticated, async (req, res) => {
  try {
    const admin = await User.findById(req.session.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Find all reimbursement requests associated with this admin
    const reimbursements = await ReimbursementRequest.find({ adminEmail: admin.email }).sort({ createdAt: -1 });

    res.status(200).json({ reimbursements });
  } catch (error) {
    console.error("Error fetching reimbursements:", error);
    res.status(500).json({ message: "Error fetching reimbursements", error });
  }
});

// Error-handling middleware for Multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // A Multer error occurred when uploading.
    return res.status(400).json({ error: err.message });
  } else if (err) {
    // An unknown error occurred.
    return res.status(500).json({ error: err.message });
  }
  next();
});

// Admin Info Endpoint
app.get("/api/admin/info", isAuthenticated, async (req, res) => {
  try {
    const admin = await User.findById(req.session.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json({ 
      company: admin.company
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching admin info", error });
  }
});

// Get user's groups endpoint
app.get("/api/groups", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).populate('groups').populate('activeGroup');
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
    console.error("Error fetching groups:", error);
    res.status(500).json({ message: "Error fetching groups", error });
  }
});

// Get user's reimbursement requests endpoint
app.get("/api/users_reimbursements", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const reimbursements = await ReimbursementRequest.find({ 
      userEmail: user.email 
    }).sort({ createdAt: -1 });

    // Transform the data to match the frontend interface
    const formattedReimbursements = reimbursements.map(reimbursement => ({
      id: reimbursement._id,
      amount: reimbursement.amount || 0,
      description: reimbursement.reimbursementDetails,
      status: reimbursement.status.toLowerCase(),
      date: reimbursement.createdAt,
      category: reimbursement.category || "Expense"
    }));

    res.json(formattedReimbursements);
  } catch (error) {
    console.error("Error fetching reimbursements:", error);
    res.status(500).json({ message: "Error fetching reimbursements", error });
  }
});

app.get("/api/user/policies", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const activeGroup = user.activeGroup;
    if (!activeGroup) {
      return res.status(400).json({ message: "No active group found" });
    }

    const userPolicy = user.policies.find(p => p.groupId.equals(activeGroup));
    const policies = userPolicy ? userPolicy.policy : {
      category: 'Expenses',
      amount: 500,
      frequency: { times: 10, days: 7 }
    };

    res.json(policies);
  } catch (error) {
    res.status(500).json({ message: "Error fetching policies", error });
  }
});

// Get admin members endpoint
app.get("/api/admin/members", isAuthenticated, async (req, res) => {
  try {
    const admin = await User.findById(req.session.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Find groups owned by the admin
    const groups = await Group.find({ adminEmail: admin.email });

    // Get users in these groups
    const users = await User.find({ groups: { $in: groups.map(g => g._id) } });

    // For each user, get their policies for the groups
    const members = users.map(user => {
      const userPolicies = user.policies
        .filter(p => groups.some(g => g._id.equals(p.groupId)))
        .map(p => ({
          groupId: p.groupId,
          policy: p.policy
        }));

      return {
        name: user.name,
        email: user.email,
        policies: userPolicies
      };
    });

    res.json({ members });

  } catch (error) {
    res.status(500).json({ message: "Error fetching members", error });
  }
});

// Get request limits status
app.get("/api/user/request_limits", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).populate('activeGroup');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.activeGroup) {
      return res.status(400).json({ message: "No active group found" });
    }

    let tracking = await RequestTracking.findOne({
      userEmail: user.email,
      groupId: user.activeGroup._id
    });
    
    if (!tracking) {
      tracking = new RequestTracking({
        userEmail: user.email,
        groupId: user.activeGroup._id
      });
    }

    const userPolicy = user.policies.find(p => p.groupId.equals(user.activeGroup._id));
    const policy = userPolicy ? userPolicy.policy : {
      category: 'Expenses',
      amount: 500,
      frequency: { times: 10, days: 7 }
    };

    const daysSinceReset = Math.floor((Date.now() - tracking.lastReset) / (1000 * 60 * 60 * 24));
    if (daysSinceReset >= policy.frequency.days) {
      tracking.count = 0;
      tracking.lastReset = new Date();
      await tracking.save();
    }

    const remainingRequests = policy.frequency.times - tracking.count;
    const nextResetDate = new Date(tracking.lastReset);
    nextResetDate.setDate(nextResetDate.getDate() + policy.frequency.days);

    res.json({
      remainingRequests,
      nextResetDate,
      maxRequests: policy.frequency.times,
      resetPeriodDays: policy.frequency.days
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching request limits", error });
  }
});

// Start the server
const PORT = process.env.PORT || 4999;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));