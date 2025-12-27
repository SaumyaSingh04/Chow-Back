const Order = require('../models/Order');

const TAX_RATE = 0.05;

/* -------------------- QUERIES -------------------- */
const SUCCESS_ORDER_QUERY = {
  status: { $in: ['confirmed', 'shipped', 'delivered'] },
  paymentStatus: 'paid'
};

const FAILED_ORDER_QUERY = {
  $or: [
    { status: 'failed' },
    { status: 'cancelled' },
    { paymentStatus: 'failed' }
  ]
};

/* -------------------- HELPERS -------------------- */
const formatAddress = (address) => {
  if (!address) return 'Address not available';

  const {
    firstName = '',
    lastName = '',
    street = '',
    city = '',
    state = '',
    postcode = ''
  } = address;

  return `${firstName} ${lastName}, ${street}, ${city}, ${state} - ${postcode}`.trim();
};

const calculateOrderTotals = (items = [], deliveryFee = 0) => {
  const subtotal = items.reduce(
    (sum, i) => sum + i.price * i.quantity,
    0
  );

  const tax = +(subtotal * TAX_RATE).toFixed(2);

  return {
    subtotal: +subtotal.toFixed(2),
    tax,
    deliveryCharge: deliveryFee
  };
};

const getDeliveryAddress = (order) => {
  if (!order.userId?.address || !order.addressId) return null;

  return (
    order.userId.address.find(
      (a) => String(a._id) === String(order.addressId)
    ) || null
  );
};

const formatOrderData = (order) => {
  const o = order.toObject();

  const deliveryAddress = getDeliveryAddress(o);
  const { subtotal, tax, deliveryCharge } = calculateOrderTotals(
    o.items,
    o.deliveryFee
  );

  const latestPayment = o.razorpayData?.at(-1) || {};

  return {
    orderId: o._id,
    orderDate: o.createdAt,

    customerName: o.userId?.name || 'N/A',
    customerEmail: o.userId?.email || 'N/A',
    customerPhone: o.userId?.phone || 'N/A',

    deliveryAddress: formatAddress(deliveryAddress),

    items: o.items,
    itemsString: o.items
      .map(
        (i) =>
          `${i.itemId?.name || 'Unknown'} (Qty: ${i.quantity}, ₹${i.price})`
      )
      .join(', '),

    subtotal,
    tax,
    deliveryCharge,
    totalAmount: o.totalAmount,

    orderStatus: o.status,
    paymentStatus: o.paymentStatus,

    razorpayOrderId: latestPayment.orderId || null,
    razorpayPaymentId: latestPayment.paymentId || null,
    paymentMethod: latestPayment.method || null,
    paymentAmount: latestPayment.amount ? latestPayment.amount / 100 : 0,

    distance: o.distance || 0
  };
};

const getOrdersWithPagination = async (query, page, limit) => {
  const skip = (page - 1) * limit;

  const [orders, total] = await Promise.all([
    Order.find(query)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price category subcategory')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Order.countDocuments(query)
  ]);

  return {
    orders: orders.map(formatOrderData),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

/* -------------------- CONTROLLERS -------------------- */

// Failed orders
exports.getFailedOrders = async (req, res) => {
  try {
    const page = +req.query.page || 1;
    const limit = +req.query.limit || 10;

    const result = await getOrdersWithPagination(
      FAILED_ORDER_QUERY,
      page,
      limit
    );

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Successful orders
exports.getAllOrders = async (req, res) => {
  try {
    const page = +req.query.page || 1;
    const limit = +req.query.limit || 10;

    const result = await getOrdersWithPagination(
      SUCCESS_ORDER_QUERY,
      page,
      limit
    );

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Order by ID
exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price category subcategory');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const o = order.toObject();
    const deliveryAddress = getDeliveryAddress(o);
    const summary = calculateOrderTotals(o.items, o.deliveryFee);

    res.json({
      success: true,
      order: {
        ...o,
        deliveryAddress,
        orderSummary: {
          ...summary,
          totalAmount: o.totalAmount
        },
        paymentDetails: {
          paymentStatus: o.paymentStatus,
          razorpayTransactions: o.razorpayData || []
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update order status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status)
      return res.status(400).json({ success: false, message: 'Status required' });

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!order)
      return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Update payment status (ADMIN / SYSTEM ONLY)
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    if (!paymentStatus)
      return res
        .status(400)
        .json({ success: false, message: 'Payment status required' });

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { paymentStatus },
      { new: true, runValidators: true }
    );

    if (!order)
      return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// My orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      userId: req.params.userId,
      ...SUCCESS_ORDER_QUERY
    })
      .populate('userId', 'name email phone address')
      .populate('items.itemId', 'name price')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      orders: orders.map((o) => ({
        ...o.toObject(),
        deliveryAddress: getDeliveryAddress(o.toObject())
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Deprecated
exports.createOrder = (_, res) => {
  res.status(400).json({
    success: false,
    message:
      'Order creation handled via /api/payment/create-order endpoint'
  });
};