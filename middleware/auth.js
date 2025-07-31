const jwt = require('jsonwebtoken');
const User = require('../models/User');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware to authenticate JWT tokens from unified auth service
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access token required' 
      });
    }

    // Validate token with unified auth service
    const unifiedAuthURL = 'https://pulasa-auth-service.onrender.com';
    const validateResponse = await fetch(`${unifiedAuthURL}/api/auth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    const validateData = await validateResponse.json();
    
    if (!validateData.success) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token' 
      });
    }

    // Find user in auction database by email
    const user = await User.findOne({ email: validateData.user.email });

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not found in auction system' 
      });
    }

    req.user = {
      _id: user._id,
      id: user._id,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin,
      wallet_balance: user.wallet_balance,
      locked_amount: user.locked_amount
    };

    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
};

// Middleware for optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      // Validate token with unified auth service
      const unifiedAuthURL = 'https://pulasa-auth-service.onrender.com';
      const validateResponse = await fetch(`${unifiedAuthURL}/api/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const validateData = await validateResponse.json();
      
      if (validateData.success) {
        // Find user in auction database by email
        const user = await User.findOne({ email: validateData.user.email });

        if (user) {
          req.user = {
            _id: user._id,
            id: user._id,
            email: user.email,
            name: user.name,
            is_admin: user.is_admin,
            wallet_balance: user.wallet_balance,
            locked_amount: user.locked_amount
          };
        }
      }
    }

    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }

    if (!req.user.is_admin) {
      return res.status(403).json({ 
        success: false, 
        error: 'Admin privileges required' 
      });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
};

// Middleware to validate user from unified auth service
const validateUnifiedUser = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access token required' 
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin,
      wallet_balance: user.wallet_balance,
      locked_amount: user.locked_amount
    };

    next();
  } catch (error) {
    console.error('Unified user validation error:', error);
    return res.status(403).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
  validateUnifiedUser
}; 