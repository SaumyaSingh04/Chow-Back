const mongoose = require('mongoose');

const sweetDealSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    default: 'Exclusive Sweet Deals'
  },
  description: {
    type: String,
    required: true
  },
  originalPrice: {
    type: Number,
    required: true
  },
  salePrice: {
    type: Number,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  videoUrl: {
    type: String,
    default: 'https://www.youtube.com/watch?v=FhlsxCf1aOU'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SweetDeal', sweetDealSchema);