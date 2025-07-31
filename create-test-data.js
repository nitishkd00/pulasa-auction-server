const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Order = require('./models/Order');
require('dotenv').config();

async function createTestData() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pulasa_auction');
    console.log('✅ Connected to MongoDB');

    // Create test users
    const testUsers = [
      {
        email: 'user1@test.com',
        password: 'user123',
        name: 'John Doe',
        phone: '9876543210',
        address: '123 Main St, City, State',
        is_admin: false,
        wallet_balance: 50000,
        locked_amount: 0
      },
      {
        email: 'user2@test.com',
        password: 'user123',
        name: 'Jane Smith',
        phone: '9876543211',
        address: '456 Oak Ave, City, State',
        is_admin: false,
        wallet_balance: 75000,
        locked_amount: 0
      },
      {
        email: 'user3@test.com',
        password: 'user123',
        name: 'Bob Johnson',
        phone: '9876543212',
        address: '789 Pine Rd, City, State',
        is_admin: false,
        wallet_balance: 30000,
        locked_amount: 0
      },
      {
        email: 'user4@test.com',
        password: 'user123',
        name: 'Alice Brown',
        phone: '9876543213',
        address: '321 Elm St, City, State',
        is_admin: false,
        wallet_balance: 60000,
        locked_amount: 0
      },
      {
        email: 'user5@test.com',
        password: 'user123',
        name: 'Charlie Wilson',
        phone: '9876543214',
        address: '654 Maple Dr, City, State',
        is_admin: false,
        wallet_balance: 45000,
        locked_amount: 0
      }
    ];

    // Create users
    const createdUsers = [];
    for (const userData of testUsers) {
      const existingUser = await User.findOne({ email: userData.email });
      if (!existingUser) {
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        const user = new User({
          email: userData.email,
          password_hash: hashedPassword,
          name: userData.name,
          phone: userData.phone,
          address: userData.address,
          is_admin: userData.is_admin,
          wallet_balance: userData.wallet_balance,
          locked_amount: userData.locked_amount
        });
        await user.save();
        createdUsers.push(user);
        console.log(`✅ Created user: ${userData.name} (${userData.email})`);
      } else {
        createdUsers.push(existingUser);
        console.log(`⚠️  User already exists: ${userData.name} (${userData.email})`);
      }
    }

    // Create test orders
    const testOrders = [
      {
        user_id: createdUsers[0]._id,
        amount: 25000,
        order_number: 'P000001',
        products: [
          {
            product_id: new mongoose.Types.ObjectId(),
            name: 'Premium Wild Pulasa',
            price: 25000,
            quantity: 1
          }
        ],
        first_name: 'John',
        last_name: 'Doe',
        phone: '9876543210',
        city: 'Hyderabad',
        state: 'Telangana',
        zip: '500001',
        status: 'order_raised',
        upi_reference: 'UPI123456789'
      },
      {
        user_id: createdUsers[1]._id,
        amount: 50000,
        order_number: 'P000002',
        products: [
          {
            product_id: new mongoose.Types.ObjectId(),
            name: 'Premium Wild Pulasa',
            price: 25000,
            quantity: 2
          }
        ],
        first_name: 'Jane',
        last_name: 'Smith',
        phone: '9876543211',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip: '400001',
        status: 'confirmed',
        upi_reference: 'UPI987654321'
      },
      {
        user_id: createdUsers[2]._id,
        amount: 25000,
        order_number: 'P000003',
        products: [
          {
            product_id: new mongoose.Types.ObjectId(),
            name: 'Pulasa Curry',
            price: 25000,
            quantity: 1
          }
        ],
        first_name: 'Bob',
        last_name: 'Johnson',
        phone: '9876543212',
        city: 'Delhi',
        state: 'Delhi',
        zip: '110001',
        status: 'packed',
        upi_reference: 'UPI456789123'
      },
      {
        user_id: createdUsers[3]._id,
        amount: 25000,
        order_number: 'P000004',
        products: [
          {
            product_id: new mongoose.Types.ObjectId(),
            name: 'Premium Wild Pulasa',
            price: 25000,
            quantity: 1
          }
        ],
        first_name: 'Alice',
        last_name: 'Brown',
        phone: '9876543213',
        city: 'Bangalore',
        state: 'Karnataka',
        zip: '560001',
        status: 'shipped',
        upi_reference: 'UPI789123456'
      },
      {
        user_id: createdUsers[4]._id,
        amount: 25000,
        order_number: 'P000005',
        products: [
          {
            product_id: new mongoose.Types.ObjectId(),
            name: 'Premium Wild Pulasa',
            price: 25000,
            quantity: 1
          }
        ],
        first_name: 'Charlie',
        last_name: 'Wilson',
        phone: '9876543214',
        city: 'Chennai',
        state: 'Tamil Nadu',
        zip: '600001',
        status: 'delivered',
        upi_reference: 'UPI321654987'
      }
    ];

    // Create orders
    for (const orderData of testOrders) {
      const existingOrder = await Order.findOne({ order_number: orderData.order_number });
      if (!existingOrder) {
        const order = new Order(orderData);
        await order.save();
        console.log(`✅ Created order: ${orderData.order_number} - ${orderData.amount} (${orderData.status})`);
      } else {
        console.log(`⚠️  Order already exists: ${orderData.order_number}`);
      }
    }

    console.log('\n🎉 Test data creation completed!');
    console.log('📊 Summary:');
    console.log(`👥 Users: ${createdUsers.length}`);
    console.log(`📦 Orders: ${testOrders.length}`);
    console.log('🔑 Admin Login: admin@auction.com / admin123');

  } catch (error) {
    console.error('❌ Error creating test data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the script
createTestData(); 