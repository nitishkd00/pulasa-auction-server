# Pulasa Auction Server

Backend server for Pulasa Auction System (Centralized)

## Features

- Auction management
- Real-time bidding with Socket.IO
- Razorpay payment integration
- MongoDB integration
- JWT authentication

## Environment Variables

Required environment variables:
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `MONGODB_URI`
- `JWT_SECRET`

## Deployment

Last deployment test: 2025-08-12 18:45:00 UTC

## API Endpoints

- `POST /api/auction/create` - Create new auction
- `GET /api/auction` - Get all auctions
- `GET /api/auction/:id` - Get single auction
- `POST /api/bid/place` - Place bid
- `POST /api/bid/verify` - Verify payment

## Status

✅ All critical fixes deployed
✅ ObjectId validation added
✅ PaymentService fixed
✅ Bid route corrected
