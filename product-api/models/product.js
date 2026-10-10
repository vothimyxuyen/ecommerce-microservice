const mongoose = require('mongoose');

const productSchema = new mongoose.Schema(
  {
    pid: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    pname: {
      type: String,
      required: true,
      trim: true
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'quantity must be an integer'
      }
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Product', productSchema);
