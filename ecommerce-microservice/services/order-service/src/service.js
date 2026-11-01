const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');
const { call, createClient, grpc, loadService } = require('../../shared/grpc');
const { calculateTotals, discountPercentForScore } = require('../../shared/discount');
const { requireInteger } = require('../../shared/validation');

const pool = new Pool({ connectionString: process.env.ORDER_DATABASE_URL });
const customers = createClient(
  loadService('customer.proto', 'ecommerce.customer.v1', 'CustomerService'),
  process.env.CUSTOMER_GRPC_ADDRESS
);
const products = createClient(
  loadService('product.proto', 'ecommerce.product.v1', 'ProductService'),
  process.env.PRODUCT_GRPC_ADDRESS
);
const topic = process.env.KAFKA_TOPIC_ORDER_CREATED || 'order-created';
let producer;
let publishTimer;
let publishing = false;

async function initialize(kafka) {
  await pool.query(await fs.readFile(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  producer = kafka.producer();
  await producer.connect();
  publishTimer = setInterval(() => publishOutbox().catch((error) => {
    console.error('Order outbox publish attempt failed:', error);
  }), 1500);
  publishTimer.unref();
  await publishOutbox();
}

async function loadOrder(oid) {
  const result = await pool.query(
    `SELECT o.oid, o.uid, o.discount, o.subtotal, o.discount_amount,
            o.total_amount, o.created_at,
            COALESCE(json_agg(json_build_object(
              'pid', d.pid, 'pname', d.pname, 'qty', d.qty, 'unit_price', d.unit_price
            )) FILTER (WHERE d.pid IS NOT NULL), '[]') AS items
     FROM orders o LEFT JOIN order_details d USING (oid)
     WHERE o.oid = $1 GROUP BY o.oid`,
    [oid]
  );
  return result.rows[0] || null;
}

function reply(order) {
  if (!order) return {};
  return {
    oid: Number(order.oid),
    uid: Number(order.uid),
    discount: Number(order.discount),
    subtotal: Number(order.subtotal),
    discount_amount: Number(order.discount_amount),
    total_amount: Number(order.total_amount),
    created_at: new Date(order.created_at).toISOString(),
    items: (order.items || []).map((item) => ({
      pid: item.pid,
      pname: item.pname,
      qty: item.qty,
      unit_price: Number(item.unit_price)
    })),
    shipment_status: 'PENDING'
  };
}

async function createOrder(request) {
  const uid = requireInteger(request.uid, 'uid');
  if (request.role !== 'member' && request.role !== 'admin') {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  if (!Array.isArray(request.items) || request.items.length < 1 || request.items.length > 50) {
    throw Object.assign(new Error('items must contain between 1 and 50 entries'), { status: 400 });
  }
  const quantities = new Map();
  for (const item of request.items) {
    const pid = requireInteger(item.pid, 'pid');
    const qty = requireInteger(item.qty, 'qty');
    const totalQty = (quantities.get(pid) || 0) + qty;
    if (!Number.isSafeInteger(totalQty)) throw Object.assign(new Error('quantity is too large'), { status: 400 });
    quantities.set(pid, totalQty);
  }

  if (request.request_id) {
    const existing = await pool.query('SELECT oid FROM orders WHERE request_key = $1', [request.request_id]);
    if (existing.rowCount) return reply(await loadOrder(existing.rows[0].oid));
  }

  const membership = await call(customers, 'GetMembership', { uid });
  const discount = discountPercentForScore(membership.score);
  const orderReference = randomUUID();
  const reserved = [];
  let committed = false;

  try {
    const itemData = [];
    for (const [pid, qty] of quantities) {
      const product = await call(products, 'GetProduct', { pid });
      const reservationId = `${orderReference}:${pid}`;
      await call(products, 'ReserveInventory', { pid, quantity: qty, reservation_id: reservationId });
      reserved.push(reservationId);
      itemData.push({ pid, pname: product.pname, qty, price: product.price });
    }

    const totals = calculateTotals(itemData, discount);
    const client = await pool.connect();
    let oid;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO orders
          (uid, discount, subtotal, discount_amount, total_amount, request_key, reservation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING oid, uid, discount, subtotal, discount_amount, total_amount, created_at`,
        [uid, totals.discount, totals.subtotal, totals.discountAmount, totals.totalAmount,
          request.request_id || null, orderReference]
      );
      oid = inserted.rows[0].oid;
      for (const item of itemData) {
        await client.query(
          'INSERT INTO order_details (oid, pid, pname, qty, unit_price) VALUES ($1, $2, $3, $4, $5)',
          [oid, item.pid, item.pname, item.qty, item.price]
        );
      }
      const eventId = randomUUID();
      const event = {
        eventId,
        eventType: 'OrderCreated',
        occurredAt: new Date().toISOString(),
        data: { oid: Number(oid), uid, items: itemData.map(({ pid, qty }) => ({ pid, qty })) }
      };
      await client.query(
        `INSERT INTO outbox_events (event_id, aggregate_id, event_type, payload)
         VALUES ($1, $2, 'OrderCreated', $3::jsonb)`,
        [eventId, oid, JSON.stringify(event)]
      );
      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('Order transaction rollback failed:', rollbackError);
      });
      throw error;
    } finally {
      client.release();
    }

    for (const reservationId of reserved) {
      await call(products, 'CommitReservation', { reservation_id: reservationId }).catch((error) => {
        console.error('Order committed but inventory confirmation is pending:', error);
      });
    }
    await publishOutbox().catch((error) => {
      console.error('Order committed; outbox publisher will retry:', error);
    });
    return reply(await loadOrder(oid));
  } catch (error) {
    if (!committed) {
      await Promise.all(reserved.map((reservationId) =>
        call(products, 'ReleaseInventory', { reservation_id: reservationId })
          .catch((releaseError) => console.error('Inventory compensation failed:', releaseError))
      ));
    }
    if (error.code === '23505' && request.request_id) {
      const existing = await pool.query('SELECT oid FROM orders WHERE request_key = $1', [request.request_id]);
      if (existing.rowCount) return reply(await loadOrder(existing.rows[0].oid));
    }
    if (error.code === grpc.status.NOT_FOUND) throw Object.assign(new Error(error.details || 'customer or product not found'), { status: 404 });
    if (error.code === grpc.status.ALREADY_EXISTS || error.code === grpc.status.FAILED_PRECONDITION) {
      throw Object.assign(new Error(error.details || 'insufficient inventory'), { status: 409 });
    }
    throw error;
  }
}

async function getOrder(request) {
  const oid = requireInteger(request.oid, 'oid');
  const order = await loadOrder(oid);
  if (!order) throw Object.assign(new Error('order not found'), { status: 404 });
  if (request.role !== 'admin' && Number(order.uid) !== Number(request.uid)) {
    throw Object.assign(new Error('forbidden'), { status: 403 });
  }
  return reply(order);
}

async function listOrders(request) {
  const uid = Number(request.uid);
  const result = request.role === 'admin'
    ? await pool.query('SELECT oid FROM orders ORDER BY created_at DESC LIMIT 100')
    : await pool.query('SELECT oid FROM orders WHERE uid = $1 ORDER BY created_at DESC LIMIT 100', [uid]);
  const items = [];
  for (const row of result.rows) items.push(reply(await loadOrder(row.oid)));
  return { items };
}

async function publishOutbox() {
  if (!producer || publishing) return;
  publishing = true;
  try {
    const result = await pool.query(
      `SELECT event_id, payload FROM outbox_events
       WHERE published_at IS NULL ORDER BY created_at LIMIT 50`
    );
    for (const event of result.rows) {
      await producer.send({
        topic,
        messages: [{ key: String(event.payload.data.oid), value: JSON.stringify(event.payload) }]
      });
      await pool.query(
        'UPDATE outbox_events SET published_at = NOW(), attempts = attempts + 1 WHERE event_id = $1',
        [event.event_id]
      );
    }
  } finally {
    publishing = false;
  }
}

function handlers() {
  return {
    CreateOrder: createOrder,
    ListOrders: listOrders,
    GetOrder: getOrder,
    Health: async () => {
      await pool.query('SELECT 1');
      return { status: 'UP' };
    }
  };
}

async function close() {
  if (publishTimer) clearInterval(publishTimer);
  customers.close();
  products.close();
  if (producer) await producer.disconnect();
  await pool.end();
}

module.exports = { close, handlers, initialize, pool };
