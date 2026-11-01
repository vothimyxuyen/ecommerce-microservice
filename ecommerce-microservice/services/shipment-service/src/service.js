const { Counter, Shipment } = require('./models');
const { requireInteger, requireText } = require('../../shared/validation');

const VALID_STATUSES = new Set(['PENDING', 'SHIPPING', 'DELIVERED', 'CANCELLED']);

function shipmentReply(shipment) {
  return {
    shipid: shipment.shipid,
    oid: shipment.oid,
    uid: shipment.uid,
    status: shipment.status,
    updated_at: shipment.updatedAt.toISOString()
  };
}

async function nextShipmentId() {
  const counter = await Counter.findByIdAndUpdate(
    'shipment',
    { $inc: { sequence: 1 } },
    { upsert: true, new: true }
  );
  return counter.sequence;
}

async function consumeOrderCreated(payload) {
  if (!payload || payload.eventType !== 'OrderCreated' || !payload.data ||
      !Number.isSafeInteger(payload.data.oid) || payload.data.oid < 1 ||
      !Number.isSafeInteger(payload.data.uid) || payload.data.uid < 1) {
    const error = new Error('invalid OrderCreated event: oid and uid are required');
    error.code = 'INVALID_EVENT';
    error.eventId = typeof payload?.eventId === 'string' ? payload.eventId : undefined;
    throw error;
  }

  const shipment = await Shipment.findOne({ oid: payload.data.oid });
  if (shipment) return shipmentReply(shipment);
  const shipid = await nextShipmentId();
  try {
    const created = await Shipment.findOneAndUpdate(
      { oid: payload.data.oid },
      {
        $setOnInsert: {
          shipid,
          oid: payload.data.oid,
          uid: payload.data.uid,
          status: 'PENDING',
          items: Array.isArray(payload.data.items) ? payload.data.items : [],
          history: [{ status: 'PENDING', changed_at: new Date() }]
        }
      },
      { upsert: true, new: true, runValidators: true }
    );
    return shipmentReply(created);
  } catch (error) {
    if (error.code === 11000) {
      const raced = await Shipment.findOne({ oid: payload.data.oid });
      if (raced) return shipmentReply(raced);
    }
    throw error;
  }
}

async function getShipment({ shipid, uid, role }) {
  const shipment = await Shipment.findOne({ shipid: requireInteger(shipid, 'shipid') }).lean();
  if (!shipment) throw Object.assign(new Error('shipment not found'), { status: 404 });
  if (!['admin', 'shipment_staff'].includes(role) && shipment.uid !== Number(uid)) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  return {
    shipid: shipment.shipid,
    oid: shipment.oid,
    uid: shipment.uid,
    status: shipment.status,
    updated_at: shipment.updatedAt.toISOString()
  };
}

async function getShipmentByOrder({ oid, uid, role }) {
  const shipment = await Shipment.findOne({ oid: requireInteger(oid, 'oid') }).lean();
  if (!shipment) throw Object.assign(new Error('shipment not found'), { status: 404 });
  if (!['admin', 'shipment_staff'].includes(role) && shipment.uid !== Number(uid)) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  return {
    shipid: shipment.shipid,
    oid: shipment.oid,
    uid: shipment.uid,
    status: shipment.status,
    updated_at: shipment.updatedAt.toISOString()
  };
}

async function updateShipmentStatus({ shipid, status }) {
  const id = requireInteger(shipid, 'shipid');
  const nextStatus = requireText(status, 'status', 50).toUpperCase();
  if (!VALID_STATUSES.has(nextStatus)) {
    throw Object.assign(new Error('status must be PENDING, SHIPPING, DELIVERED, or CANCELLED'), { status: 400 });
  }
  const shipment = await Shipment.findOne({ shipid: id });
  if (!shipment) throw Object.assign(new Error('shipment not found'), { status: 404 });
  const allowed = {
    PENDING: ['SHIPPING', 'CANCELLED'],
    SHIPPING: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: []
  };
  if (shipment.status !== nextStatus && !allowed[shipment.status].includes(nextStatus)) {
    throw Object.assign(new Error(`cannot change shipment from ${shipment.status} to ${nextStatus}`), { status: 409 });
  }
  if (shipment.status !== nextStatus) {
    shipment.status = nextStatus;
    shipment.history.push({ status: nextStatus, changed_at: new Date() });
    await shipment.save();
  }
  return shipmentReply(shipment);
}

function handlers(isKafkaConnected = () => true) {
  return {
    GetShipment: getShipment,
    GetShipmentByOrder: getShipmentByOrder,
    UpdateShipmentStatus: updateShipmentStatus,
    Health: async () => {
      await Shipment.db.db.admin().ping();
      if (!isKafkaConnected()) throw Object.assign(new Error('Kafka consumer disconnected'), { status: 503 });
      return { status: 'UP' };
    }
  };
}

module.exports = { consumeOrderCreated, handlers };
