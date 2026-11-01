const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  pid: { type: Number, required: true, unique: true, index: true },
  pname: { type: String, required: true, trim: true, maxlength: 100 },
  price: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 0, validate: Number.isInteger }
}, { timestamps: true, versionKey: false });

const counterSchema = new mongoose.Schema({
  _id: String,
  sequence: { type: Number, default: 0 }
}, { versionKey: false });

const reservationSchema = new mongoose.Schema({
  reservation_id: { type: String, required: true, unique: true },
  pid: { type: Number, required: true },
  quantity: { type: Number, required: true },
  status: { type: String, enum: ['RESERVED', 'COMMITTED', 'RELEASED'], required: true }
}, { timestamps: true, versionKey: false });

module.exports = {
  Counter: mongoose.model('ProductCounter', counterSchema),
  Product: mongoose.model('Product', productSchema),
  Reservation: mongoose.model('InventoryReservation', reservationSchema)
};
