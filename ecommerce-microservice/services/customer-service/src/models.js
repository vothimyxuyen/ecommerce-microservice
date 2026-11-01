const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  uid: { type: Number, required: true, unique: true, min: 1 },
  fullname: { type: String, required: true, trim: true, maxlength: 100 },
  age: { type: Number, required: true, min: 0, max: 130, default: 0 },
  address: { type: String, required: true, maxlength: 255, default: '' },
  mid: { type: Number, required: true, min: 1, default: 1 }
}, { timestamps: true, versionKey: false });

const membershipSchema = new mongoose.Schema({
  mid: { type: Number, required: true, unique: true, min: 1 },
  mname: { type: String, required: true, unique: true, trim: true, maxlength: 50 },
  score: { type: Number, required: true, min: 0, default: 10 }
}, { timestamps: true, versionKey: false });

module.exports = {
  Customer: mongoose.model('Customer', customerSchema),
  Membership: mongoose.model('Membership', membershipSchema)
};
