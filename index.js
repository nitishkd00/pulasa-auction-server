const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const path = require('path');

const { connectDatabase } = require('./config/database');
const cron = require('node-cron');
const Auction = require('./models/Auction');
const Bid = require('./models/Bid');
const AuctionEvent = require('./models/AuctionEvent');
const auctionEndService = require('./services/auctionEndService');
const auctionStartService = require('./services/auctionStartService');

const app = express();
app.set('trust proxy', 1); // Trust the first proxy (React dev server)
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {

    origin: [
      "https://auction.pulasa.com",
      "https://www.pulasa.com", 
      "https://pulasa.com",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:8080"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

const userSockets = {}; // userId -> socketId

// Security middleware
app.use(helmet());
app.use(cors({
  origin: function (origin, callback) {
    console.log(`🌐 AUCTION SERVER CORS request from origin: ${origin || 'null'}`);

    // Allow requests with no origin (like mobile apps, file://, or server-to-server)
    if (!origin) {
      console.log('✅ AUCTION CORS: Allowing request with no origin');
      return callback(null, true);
    }

    // Allow file:// protocol for testing tools
    if (origin.startsWith('file://')) {
      console.log('✅ AUCTION CORS: Allowing file:// origin for testing tools');
      return callback(null, true);
    }

    // Allow localhost with any port for development
    if (origin.match(/^https?:\/\/localhost(:\d+)?$/)) {
      console.log('✅ AUCTION CORS: Allowing localhost origin');
      return callback(null, true);
    }

    // Allow specific origins - simplified list
    const allowedOrigins = [
      "https://auction.pulasa.com",
      "https://www.pulasa.com", 
      "https://pulasa.com",
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:8080"
    ];
    
    if (allowedOrigins.includes(origin)) {
      console.log('✅ AUCTION CORS: Allowing configured origin');
      return callback(null, true);
    }

    // Log rejected origins for debugging
    console.log(`❌ AUCTION CORS: Rejecting origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Render
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    success: true,
    status: 'OK',
    service: 'auction-server',
    message: 'Pulasa Auction Server is running',
    version: '1.0.0',
    mode: 'centralized',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    features: ['auctions', 'real-time-bidding'],
    codeVersion: '9781d16' // Add this to verify code changes
  });
});

// Ping endpoint for UptimeRobot
app.get('/ping', (req, res) => {
  res.status(200).json({ 
    status: 'pong', 
    timestamp: new Date().toISOString(),
    service: 'auction-server'
  });
});

function setupAuctionEndingJob(io, userSockets) {
  cron.schedule('* * * * *', async () => { // every minute
    const now = new Date();
    const auctions = await Auction.find({
      end_time: { $lte: now },
      status: { $ne: 'cancelled' },
      winner: null
    });
    for (const auction of auctions) {
      const highestBid = await Bid.findOne({ auction: auction._id, status: 'success' }).sort({ amount: -1 });
      if (highestBid) {
        auction.winner = highestBid.bidder;
        auction.winning_amount = highestBid.amount;
        auction.status = 'ended';
        await auction.save();
        highestBid.status = 'won';
        await highestBid.save();
        await AuctionEvent.create({
          auction: auction._id,
          event_type: 'winner_declared',
          user: highestBid.bidder,
          amount: highestBid.amount,
          description: `Winner declared: User ${highestBid.bidder} with ₹${highestBid.amount}`
        });
        // Emit winner notification
        const winnerSocketId = userSockets[highestBid.bidder.toString()];
        if (winnerSocketId) {
          io.to(winnerSocketId).emit('auctionWon', {
            auctionId: auction._id.toString(),
            itemName: auction.item_name,
            amount: highestBid.amount
          });
        }
      } else {
        auction.status = 'ended';
        await auction.save();
      }
    }
  });
}

async function startServer() {
  try {
    await connectDatabase();

    // Import routes only after DB is connected
    const authRoutes = require('./routes/auth');
    const auctionRoutes = require('./routes/auction');
    const bidRoutes = require('./routes/bid');
    const adminRoutes = require('./routes/admin');
    const adminAuctionRoutes = require('./routes/admin-auctions');
    const notificationRoutes = require('./routes/notifications');
    const webhookRoutes = require("./routes/webhooks");

    // Routes
    app.use('/api/auth', authRoutes);
    app.use('/api/auction', auctionRoutes);
    app.use('/api/bid', bidRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/admin/auctions', adminAuctionRoutes);
    app.use('/api/notifications', notificationRoutes);
    app.use('/api/webhooks', webhookRoutes);

    // Health check endpoint for Render
    app.get('/api/health', (req, res) => {
      res.status(200).json({ 
        status: 'OK',
        service: 'auction-server',
        message: 'Pulasa Auction Server is running',
        version: '1.0.0',
        mode: 'centralized',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        features: ['auctions', 'real-time-bidding']
      });
    });

    // Manual auction status fix endpoint (for immediate testing)
    app.post('/api/admin/fix-auction-status', async (req, res) => {
      try {
        const { auctionId } = req.body;
        
        if (!auctionId) {
          return res.status(400).json({ error: 'Auction ID is required' });
        }

        console.log(`🔧 Manual auction status fix requested for: ${auctionId}`);
        
        const result = await auctionStartService.startSpecificAuction(auctionId);
        
        res.json({
          success: true,
          message: 'Auction status fixed successfully',
          result
        });
        
      } catch (error) {
        console.error('❌ Manual auction status fix failed:', error);
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Socket.IO connection handling
    io.on('connection', (socket) => {
      console.log('User connected:', socket.id);

      // Register user for targeted events
      socket.on('registerUser', (userId) => {
        userSockets[userId] = socket.id;
        console.log(`Registered user ${userId} to socket ${socket.id}`);
      });

      // Join auction room
      socket.on('joinAuction', (auctionId) => {
        const roomName = `auction_${auctionId}`;
        console.log(`🔌 Socket ${socket.id} joining auction room: ${roomName} for auction: ${auctionId}`);
        
        socket.join(roomName);
        console.log(`✅ Socket ${socket.id} successfully joined room: ${roomName}`);
        
        // Log all rooms this socket is in for debugging
        console.log(`🔍 Socket ${socket.id} rooms after joining:`);
        socket.rooms.forEach(room => {
          if (room.startsWith('auction_')) {
            console.log(`   📍 Auction room: ${room}`);
          }
        });
        
        // Verify room membership
        if (socket.rooms.has(roomName)) {
          console.log(`✅ Verification: Socket ${socket.id} is confirmed in room ${roomName}`);
        } else {
          console.log(`❌ ERROR: Socket ${socket.id} failed to join room ${roomName}`);
        }
      });

      // Leave auction room
      socket.on('leaveAuction', (auctionId) => {
        socket.leave(`auction_${auctionId}`);
        console.log(`User ${socket.id} left auction ${auctionId}`);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Remove user from userSockets on disconnect
        for (const [userId, id] of Object.entries(userSockets)) {
          if (id === socket.id) delete userSockets[userId];
        }
      });
    });

    // Make io available to routes
    app.set('io', io);
    app.set('userSockets', userSockets);

    setupAuctionEndingJob(io, userSockets);

    // Backend-only service - no frontend files to serve
    app.get('/', (req, res) => {
      res.json({
        success: true,
        service: 'pulasa-auction-server',
        message: 'Pulasa Auction Server API is running',
        version: '1.0.0',
        endpoints: [
          '/api/health',
          '/api/auction',
          '/api/bid',
          '/api/admin',
          '/api/webhooks'
        ]
      });
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error(err.stack);
      res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
      });
    });

    // 404 handler (for API routes only)
    app.use('/api/*', (req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });

    const PORT = process.env.PORT || 5001;

    server.listen(PORT, () => {
      // Start auction start processing cron job
      auctionStartService.startCronJob();
      // Start auction end processing cron job
      auctionEndService.startCronJob();
      console.log(`🚀 Pulasa Auction Server running on port ${PORT}`);
      console.log(`📡 Socket.IO server initialized`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🏛️  Mode: Centralized Auction System with Razorpay Authorize-Capture (MongoDB)`);
    });
  } catch (err) {
    console.error('Failed to connect to MongoDB or start server:', err);
    process.exit(1);
  }
}

startServer();

// FORCE DEPLOYMENT: Timestamp 2025-08-12 21:15:00 - Fix bid flow
