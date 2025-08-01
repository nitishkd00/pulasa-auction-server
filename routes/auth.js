const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// In-memory store for reset codes (replace with DB in production)
const resetCodes = {};

const router = express.Router();

// Register user
router.post('/register', [
  body('username')
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    // Hash password
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create new user
    const newUser = await User.create({
      username,
      email,
      password_hash: passwordHash
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: newUser._id,
        mongoId: newUser._id,
        username: newUser.username,
        email: newUser.email,
        name: newUser.username,
        is_admin: newUser.is_admin,
        wallet_balance: 0,
        locked_amount: 0,
        created_at: newUser.created_at,
        updated_at: newUser.updated_at
      },
      tokens: {
        jwtToken: token,
        tokenType: 'Bearer',
        expiresIn: '7d'
      },
      source: 'auction_local'
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', [
  body('email').isEmail().withMessage('Please provide a valid email address'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user._id,
        mongoId: user._id,
        username: user.username,
        email: user.email,
        name: user.username,
        is_admin: user.is_admin,
        wallet_balance: user.wallet_balance || 0,
        locked_amount: user.locked_amount || 0,
        created_at: user.created_at,
        updated_at: user.updated_at
      },
      tokens: {
        jwtToken: token,
        tokenType: 'Bearer',
        expiresIn: '7d'
      },
      source: 'auction_local'
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'No user with that email' });
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
  const expires = Date.now() + 15 * 60 * 1000; // 15 min expiry
  resetCodes[email] = { code, expires };
  // Send email
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'user@example.com',
      pass: process.env.SMTP_PASS || 'password',
    },
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@yourapp.com',
    to: email,
    subject: 'Your Password Reset Code',
    text: `Your password reset code is: ${code}`,
  });
  res.json({ message: 'Reset code sent to email' });
});

// POST /reset-password
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'All fields required' });
  const entry = resetCodes[email];
  if (!entry || entry.code !== code || Date.now() > entry.expires) {
    return res.status(400).json({ error: 'Invalid or expired code' });
  }
  // Password strength: min 8, 1 uppercase, 1 symbol
  if (!/^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters, include an uppercase letter and a symbol.' });
  }
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: 'No user with that email' });
  user.password_hash = await bcrypt.hash(newPassword, 10);
  await user.save();
  delete resetCodes[email];
  res.json({ message: 'Password updated successfully' });
});

// Validate token endpoint (fallback for local tokens)
router.post('/validate', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token is required'
      });
    }

    // First try to validate with unified auth service
    try {
      const axios = require('axios');
      const unifiedAuthUrl = 'https://api.pulasa.com';
      const validation = await axios.post(`${unifiedAuthUrl}/api/auth/validate`, {
        token: token
      }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (validation.data.success && validation.data.valid) {
        console.log('✅ Token validated by unified auth service');
        return res.json({
          success: true,
          valid: true,
          user: validation.data.user,
          source: 'unified'
        });
      }
    } catch (unifiedAuthError) {
      console.log('⚠️ Unified auth validation failed, trying local validation:', unifiedAuthError.message);
    }

    // Fallback to local JWT validation
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        valid: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      valid: true,
      user: {
        id: user._id,
        mongoId: user._id,
        username: user.username,
        email: user.email,
        name: user.username,
        is_admin: user.is_admin,
        wallet_balance: user.wallet_balance || 0,
        locked_amount: user.locked_amount || 0,
        created_at: user.created_at,
        updated_at: user.updated_at
      },
      source: 'local'
    });

  } catch (error) {
    console.error('Token validation error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        valid: false,
        error: 'Token expired'
      });
    }
    return res.status(401).json({
      success: false,
      valid: false,
      error: 'Invalid token'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    // You may want to fetch the user from DB for latest info
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        is_admin: user.is_admin
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

module.exports = router;