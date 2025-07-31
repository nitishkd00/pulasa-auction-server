// SSE endpoint for real-time updates (Vercel compatible)
const express = require('express');
const router = express.Router();

// Store active connections
const connections = new Map();

// SSE endpoint for auction updates
router.get('/api/auction/:auctionId/events', (req, res) => {
  const { auctionId } = req.params;
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', auctionId })}\n\n`);

  // Store connection
  if (!connections.has(auctionId)) {
    connections.set(auctionId, new Set());
  }
  connections.get(auctionId).add(res);

  // Handle client disconnect
  req.on('close', () => {
    if (connections.has(auctionId)) {
      connections.get(auctionId).delete(res);
      if (connections.get(auctionId).size === 0) {
        connections.delete(auctionId);
      }
    }
  });
});

// Function to broadcast updates to all connected clients
const broadcastToAuction = (auctionId, data) => {
  if (connections.has(auctionId)) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    connections.get(auctionId).forEach(client => {
      client.write(message);
    });
  }
};

// Function to broadcast new bid
const broadcastNewBid = (auctionId, bidData) => {
  broadcastToAuction(auctionId, {
    type: 'newBid',
    auctionId,
    bid: bidData
  });
};

// Function to broadcast auction end
const broadcastAuctionEnd = (auctionId, winnerData) => {
  broadcastToAuction(auctionId, {
    type: 'auctionEnded',
    auctionId,
    winner: winnerData
  });
};

module.exports = { router, broadcastNewBid, broadcastAuctionEnd }; 