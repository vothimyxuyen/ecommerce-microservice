const mongoose = require('mongoose');

const shipmentSchema = new mongoose.Schema({
  shipid: { type: Number, unique: true, index: true },
  oid: { type: Number, required: true, unique: true, index: true },
  uid: { type: Number, required: true, index: true },
  status: {
    type: String,
    required: true,
    enum: ['PENDING', 'SHIPPING', 'DELIVERED', 'CANCELLED'],
    default: 'PENDING'
  },
  items: [{ pid: Number, qty: Number }],
  history: [{ status: String, changed_at: Date }]
}, { timestamps: true, versionKey: false });

const counterSchema = new mongoose.Schema({
  _id: String,
  sequence: { type: Number, default: 0 }
}, { versionKey: false });

const failedEventSchema = new mongoose.Schema({
  event_id: { type: String, unique: true },
  payload: mongoose.Schema.Types.Mixed,
  error: { type: String, required: true }
}, { timestamps: true, versionKey: false });

module.exports = {
  Counter: mongoose.model('ShipmentCounter', counterSchema),
  FailedEvent: mongoose.model('FailedOrderEvent', failedEventSchema),
  Shipment: mongoose.model('Shipment', shipmentSchema)
};
