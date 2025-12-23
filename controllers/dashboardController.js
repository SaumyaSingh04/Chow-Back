const Order = require('../models/Order');
const User = require('../models/User');
const Ticket = require('../models/Ticket');

// Get dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      newOrders,
      totalCustomers,
      ticketsResolved,
      revenueToday,
      failedOrders
    ] = await Promise.all([
      Order.countDocuments({ 
        createdAt: { $gte: today, $lt: tomorrow },
        status: { $ne: 'failed' }
      }),
      User.countDocuments({ status: 'active' }),
      Ticket.countDocuments({ 
        status: 'resolved',
        updatedAt: { $gte: today, $lt: tomorrow }
      }),
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: today, $lt: tomorrow },
            paymentStatus: 'paid'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$totalAmount' }
          }
        }
      ]),
      Order.countDocuments({
        createdAt: { $gte: today, $lt: tomorrow },
        $or: [
          { status: 'failed' },
          { paymentStatus: 'failed' }
        ]
      })
    ]);

    res.json({
      newOrders,
      totalCustomers,
      ticketsResolved,
      revenueToday: revenueToday[0]?.total || 0,
      failedOrders
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get failed orders
exports.getFailedOrders = async (req, res) => {
  try {
    const failedOrders = await Order.find({
      $or: [
        { status: 'failed' },
        { paymentStatus: 'failed' }
      ]
    })
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price')
      .sort({ createdAt: -1 });
    
    const ordersWithAddress = failedOrders.map(order => ({
      ...order.toObject(),
      deliveryAddress: order.userId?.address?.id(order.addressId) || null
    }));
    
    res.json({ success: true, orders: ordersWithAddress });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};