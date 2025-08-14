# 🧪 Testing Automatic Outbid Refunds

This document explains how to test the automatic refund functionality when users get outbid.

## 🎯 What This Test Does

The test script simulates the complete outbid scenario:
1. **User 1** places a bid of ₹150
2. **User 2** places a higher bid of ₹200
3. **System automatically** refunds User 1 and marks them as outbid
4. **Verifies** that the refund flow works correctly

## 🚀 How to Run the Test

### Prerequisites
- MongoDB running locally or accessible via `MONGODB_URI` environment variable
- Node.js installed
- Dependencies installed (`npm install`)

### Running the Test

```bash
# Option 1: Using npm script
npm run test-refund

# Option 2: Direct execution
node test-refund-flow.js
```

### Environment Variables
Set these if testing against a remote MongoDB:
```bash
export MONGODB_URI="mongodb://your-mongodb-uri"
```

## 📊 Expected Test Output

```
🧪 Starting automatic outbid refund test...

✅ Connected to MongoDB

👥 Step 1: Creating test users...
✅ Created test users: testuser1, testuser2

🏷️ Step 2: Creating test auction...
✅ Created test auction: Test Item for Refund

💰 Step 3: Simulating first bid by User 1...
✅ User 1 placed bid: ₹150
✅ Auction highest bid updated to: ₹150

🚀 Step 4: Simulating second bid by User 2 (should trigger automatic refund)...
📊 Current auction state:
   - Highest bid: ₹150
   - Highest bidder: [user1_id]
💰 User 2 attempting to bid: ₹200
🔄 Outbid detected! Processing automatic refund...
💰 Processing refund for User 1's bid of ₹150
✅ Refund processed: test_refund_[timestamp]
✅ User 1's bid status updated to: outbid
✅ Payment status updated to: refunded
✅ User 2's bid placed successfully: ₹200

🔍 Step 5: Verifying automatic refund results...

📊 User 1's bid status:
   - Status: outbid
   - Payment Status: refunded
   - Refund Details: Present
   - Refund ID: test_refund_[timestamp]
   - Refund Amount: ₹150
   - Refund Reason: Outbid by another user

📊 User 2's bid status:
   - Status: active
   - Payment Status: authorized

📊 Final auction state:
   - Highest bid: ₹200
   - Highest bidder: [user2_id]

🎯 Test Results:
✅ SUCCESS: Automatic refund worked correctly!
   - User 1 was automatically outbid
   - Payment was automatically refunded
   - Refund details were properly recorded
✅ SUCCESS: New bid was properly recorded!
   - User 2 is now the highest bidder
   - Auction highest bid was updated correctly

🧹 Cleaning up test data...
✅ Test data cleaned up
✅ Disconnected from MongoDB

🏁 Test completed!
```

## 🔍 What the Test Verifies

1. **Automatic Refund Processing**: When User 2 outbids User 1, the system automatically:
   - Detects the outbid scenario
   - Processes the refund for User 1
   - Updates User 1's bid status to "outbid"
   - Marks payment status as "refunded"
   - Records refund details

2. **New Bid Recording**: User 2's bid is properly recorded:
   - Bid status is "active"
   - Auction highest bid is updated
   - User 2 becomes the highest bidder

3. **Data Integrity**: All database updates are performed correctly and consistently

## 🚨 Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB is running
- Check `MONGODB_URI` environment variable
- Verify network connectivity

### Test Data Issues
- The test automatically cleans up after itself
- If interrupted, manually clean up test data from MongoDB

### Permission Issues
- Ensure the MongoDB user has read/write permissions
- Check if the database exists and is accessible

## 📝 Notes

- This is a **local test script** - it doesn't make actual Razorpay API calls
- The refund is simulated for testing purposes
- In production, the actual Razorpay refund API would be called
- The test verifies the **business logic** and **database operations**
- Real payment processing would require valid Razorpay credentials and test mode

## 🔄 Real-World Testing

To test with actual payments:
1. Use Razorpay test mode credentials
2. Create real auction items
3. Use test payment methods
4. Monitor Razorpay dashboard for actual refunds
