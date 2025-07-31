const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
require('dotenv').config();

async function createAdminUser() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pulasa_auction');
    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'admin@auction.com' });
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists');
      console.log('Email: admin@auction.com');
      console.log('Password: admin123');
      console.log('Name: Auction Admin');
      console.log('Is Admin: true');
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('admin123', 10);

    // Create admin user
    const adminUser = new User({
      email: 'admin@auction.com',
      password_hash: hashedPassword,
      name: 'Auction Admin',
      phone: '9999999999',
      address: 'Admin Address',
      is_admin: true,
      wallet_balance: 100000, // ₹1,00,000 for testing
      locked_amount: 0
    });

    await adminUser.save();
    console.log('✅ Admin user created successfully!');
    console.log('📧 Email: admin@auction.com');
    console.log('🔑 Password: admin123');
    console.log('👤 Name: Auction Admin');
    console.log('👑 Is Admin: true');
    console.log('💰 Wallet Balance: ₹1,00,000');

  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
createAdminUser(); 