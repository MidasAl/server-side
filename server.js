// server.js

const express = require("express");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer"); // For handling file uploads
const fs = require("fs");
const path = require("path");
const { requestReimbursement, MultiFileProcessor, categorizeAndExtractAmountFromPdf } = require('./reimbursement-processor');
const AWS = require("aws-sdk");

require("dotenv").config();
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // Make sure to set this in .env

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
  department: { type: String, default: 'General' },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  groups: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Group' }], // Array of group IDs
  activeGroup: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null }, // Active group ID
});

const User = mongoose.model("User", userSchema);

// InviteCode schema and model
const inviteCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  used: { type: Boolean, default: false },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }, // 7 days expiry
});

const InviteCode = mongoose.model('InviteCode', inviteCodeSchema);

// ReimbursementRequest schema and model
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

const ReimbursementRequest = mongoose.model("ReimbursementRequest", reimbursementRequestSchema);

// Group schema and model
const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  company: { type: String, required: true },
  inviteCode: { type: String, required: true, unique: true },
  adminEmail: { type: String, required: true }, // Admin's email
  isPrivate: { type: Boolean, default: false },
  memberCount: { type: Number, default: 0 },
  lastActive: { type: Date, default: Date.now }
});

const Group = mongoose.model('Group', groupSchema);

// New schemas for policy management
const requestCountSchema = new mongoose.Schema({
  userEmail: String,
  adminEmail: String,
  count: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});
const RequestCount = mongoose.model('RequestCount', requestCountSchema);

// Middleware
var secure = false;
var sameSite = 'lax';
var corsOrigin = 'http://localhost:3000'; // Default development URL

if (process.env.NODE_ENV === 'production') {
  secure = true;
  sameSite = 'none';
  corsOrigin = process.env.NEXT_PUBLIC_API_URL || 'https://front-end-lime-zeta.vercel.app';
} 

app.use(cors({
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.set('trust proxy', 1);

// Serve the 'uploads' directory as static
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer for file uploads
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
      'application/zip'
    ];
    if (!allowed_types.includes(file.mimetype)) {
      return cb(new Error('Only .docx, .pdf, .jpg, .png and .zip files are allowed!'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

// Register endpoint
app.post("/api/register", async (req, res) => {
  const { name, company, email, password, confirmPassword, isAdmin, department } = req.body;

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
      department: department || 'General',
      role: role,
      groups: [],
      activeGroup: null,
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

    // Create JWT payload
    const payload = {
      userId: user._id,
      email: user.email,
      role: user.role,
    };

    // Generate JWT
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
    res.json({
      message: "Login successful!",
      token, // Send token to the frontend
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
    const user = await User.findById(req.user.userId).populate('activeGroup');
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
  // With JWT, the client just needs to remove the token
  res.json({ message: "Logged out successfully" });
});

// Generate invite code endpoint
app.post("/api/admin/generate-code", isAuthenticated, async (req, res) => {
  try {
    // First, verify the user is an admin
    const user = await User.findById(req.user.userId);

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
    const admin = await User.findById(req.user.userId);
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
        createdAt: user.createdAt,
        department: user.department
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

    const user = await User.findById(req.user.userId);
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
    console.log(user.email);
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
    const user = await User.findById(req.user.userId);

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

async function forwardReimbursementRequest(data, receiptPath) {
  try {
    console.log('Starting forwardReimbursementRequest with path:', receiptPath);
    console.log('Input data:', data);

    // Create a file object similar to what multer would create
    const fileObj = {
      originalname: receiptPath.split('/').pop(), // Gets filename from path
      buffer: await fs.promises.readFile(receiptPath) // Read file into buffer
    };
    console.log('Created file object with name:', fileObj.originalname);

    // Prepare data object in the format our JS function expects
    const requestData = {
      role: data.role,
      name: data.name,
      email: data.email,
      admin_email: data.admin_email,
      reimbursement_details: data.reimbursement_details,
      files: [fileObj]
    };
    console.log('Prepared request data:', {
      ...requestData,
      files: [`${requestData.files.length} files included`]  // Don't log the full buffer
    });

    console.log('Calling requestReimbursement...');
    // Call our JS implementation
    const response = await requestReimbursement(requestData);
    console.log('Received response from requestReimbursement:', response);

    // The response is already in the correct format:
    // {
    //   status: 'Approved' or 'Rejected',
    //   feedback: 'Analysis feedback text',
    //   processed_files: number,
    //   uploaded_files: ['s3_url1', 's3_url2', ...]
    // }
    
    return response;
  } catch (error) {
    console.error("Error in forwardReimbursementRequest:", {
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

app.post("/api/request_reimbursement", upload.single('receipt'), isAuthenticated, async (req, res) => {
  console.log("Received request body:", req.body);
  console.log("Received file:", req.file);

  const { reimbursement_details } = req.body;
  const receipt = req.file;

  try {
    // Get user from JWT token instead of session
    const user = await User.findById(req.user.userId).populate('activeGroup');
    if (!user) {
      if (receipt && fs.existsSync(receipt.path)) {
        fs.unlinkSync(receipt.path);
      }
      return res.status(401).json({ 
        status: "Error",
        feedback: "User not authenticated."
      });
    }

    // Validate role
    if (user.role !== 'user') {
      if (receipt && fs.existsSync(receipt.path)) {
        fs.unlinkSync(receipt.path);
      }
      return res.status(403).json({ 
        status: "Error",
        feedback: "Only users with 'user' role can submit reimbursement requests."
      });
    }

    // Validate receipt file
    if (!receipt) {
      return res.status(400).json({ 
        status: "Error",
        feedback: "Receipt file is required."
      });
    }

    // Get admin email from user's active group
    const admin_email = user.activeGroup ? user.activeGroup.adminEmail : null;
    if (!admin_email) {
      return res.status(400).json({ 
        status: "Error",
        feedback: "No active group or admin email found."
      });
    }

    // Forward to our JavaScript processor
    console.log("Forwarding to reimbursement processor");
    const processedResponse = await forwardReimbursementRequest(
      {
        role: user.role,
        name: user.name,
        email: user.email,
        admin_email,
        reimbursement_details
      },
      receipt.path
    );

    // Save the reimbursement request in the database
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
      amount: parsedDetails.amount || "0",
      category: parsedDetails.type || "unknown",
      receiptPath: receipt.path,
      s3Urls: processedResponse.uploaded_files || [],
      status: processedResponse.status,
      feedback: processedResponse.feedback,
      groupId: user.activeGroup._id,
      createdAt: new Date()
    });

    await reimbursementRequest.save();
    console.log("Reimbursement request saved to database");

    // Set response headers
    res.setHeader('Content-Type', 'application/json');

    // Prepare and send response
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
    // Only cleanup temporary files if needed
    if (receipt && fs.existsSync(receipt.path)) {
      // You might want to check if it's a temp file before deleting
      if (receipt.path.includes('temp') || receipt.path.includes('tmp')) {
        fs.unlinkSync(receipt.path);
      }
    }
  }
});

// Admin Dashboard to View Reimbursement Requests
app.get("/api/admin/reimbursements", isAuthenticated, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId);
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
    const admin = await User.findById(req.user.userId);
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
    const user = await User.findById(req.user.userId).populate('groups').populate('activeGroup');
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
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const reimbursements = await ReimbursementRequest.find({ 
      userEmail: user.email 
    }).sort({ createdAt: -1 });

    // Transform the data to match the frontend interface
    const formattedReimbursements = reimbursements.map(r => ({
      id: r._id,
      amount: 0, // You might want to add this field to your schema
      description: r.reimbursementDetails,
      status: r.status.toLowerCase(),
      date: r.createdAt,
      category: "Expense" // You might want to add this field to your schema
    }));

    res.json(formattedReimbursements);
  } catch (error) {
    console.error("Error fetching reimbursements:", error);
    res.status(500).json({ message: "Error fetching reimbursements", error });
  }
});

// Policy Management 
// 
//

// New endpoint for admin policy upload
app.post("/api/admin/upload_policy", isAuthenticated, upload.single('policyFile'), async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const adminRepo = admin.email.replace('@', '').replace(/\./g, '');
    const s3Key = `Reimbursement/${adminRepo}/policies/${file.originalname}`;
    
    await s3_client.upload({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: s3Key,
      Body: fs.createReadStream(file.path),
      ContentType: file.mimetype
    }).promise();

    // Cleanup: Remove local file after upload
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }

    // Mark as active
    await s3_client.upload({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: `Reimbursement/${adminRepo}/policies/ACTIVE`,
      Body: 'ACTIVE'
    }).promise();

    res.json({ 
      message: 'Policy uploaded successfully',
      files: [s3Key]
    });
  } catch (error) {
    console.error('Error uploading policy:', error);
    res.status(500).json({ message: 'Error uploading policy', error: error.message });
  }
});

// Add after other endpoints
app.post("/api/admin/manual_policy", isAuthenticated, async (req, res) => {
  try {
    console.log("Uploading policy to S3:")
    const admin = await User.findById(req.session.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { category, amount, times, period } = req.body;
    if (!category || !amount || !times || !period) {
      return res.status(400).json({ message: 'All fields required' });
    }

    if (!['day', 'week', 'month', 'year'].includes(period)) {
      return res.status(400).json({ message: 'Invalid period' });
    }

    const policyText = `Allow this user to spend in ${category} up to the amount of ${amount}. The user is allowed to make requests ${times} times per ${period}.`;
    const adminRepo = admin.email.replace('@', '').replace(/\./g, '');
    const s3Key = `Reimbursement/${adminRepo}/policies/manual_${category}.txt`;
    await s3_client.upload({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: s3Key,
      Body: policyText
    }).promise();

    await s3_client.upload({
      Bucket: AWS_S3_BUCKET_NAME,
      Key: `Reimbursement/${adminRepo}/policies/ACTIVE`,
      Body: 'ACTIVE'
    }).promise();

    res.json({ message: 'Policy created successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error creating policy', error: error.message });
  }
});

// New endpoint to list all policies for an admin
app.get("/api/admin/policies", isAuthenticated, async (req, res) => {
  try {
    const admin = await User.findById(req.user.userId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const adminRepo = admin.email.replace('@', '').replace(/\./g, '');
    const s3Prefix = `Reimbursement/${adminRepo}/policies/`;

    const params = {
      Bucket: AWS_S3_BUCKET_NAME,
      Prefix: s3Prefix
    };

    const data = await s3_client.listObjectsV2(params).promise();
    const policyFiles = data.Contents.map(item => path.basename(item.Key, path.extname(item.Key)));

    res.json({ policies: policyFiles });
  } catch (error) {
    console.error('Error fetching policies:', error);
    res.status(500).json({ message: 'Error fetching policies', error: error.message });
  }
});

// Endpoint to extract text from a PDF
app.post("/api/extract_pdf_text", upload.single('policyFile'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Ensure the file is a PDF
    if (path.extname(file.originalname).toLowerCase() !== '.pdf') {
      return res.status(400).json({ message: 'Only PDF files are allowed' });
    }

    // Call the extractTextFromPdf function
    const text = await MultiFileProcessor.extractTextFromPdf(file.path);
    // Categorize the expense and extract amount
    const extractedData = await categorizeAndExtractAmountFromPdf(text);

    let category = 'Could not detect';
    let amount = 'Could not detect';

    if (extractedData.length > 0) {
      category = extractedData[0].category;
      amount = extractedData[0].amount;
    }
    const info = `Category: ${category}\nAmount: ${amount}\nDate: ${"everyday"}`;
    res.json({ info });
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    res.status(500).json({ message: 'Error extracting text from PDF', error: error.message });
  } finally {
    // Cleanup: Remove the uploaded file
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));