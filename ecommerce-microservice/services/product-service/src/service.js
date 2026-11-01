const { Counter, Product, Reservation } = require('./models');
const { requireInteger, requireText } = require('../../shared/validation');

function productReply(product) {
  return {
    pid: product.pid,
    pname: product.pname,
    price: Number(product.price),
    quantity: product.quantity
  };
}

async function nextProductId() {
  const counter = await Counter.findByIdAndUpdate(
    'product',
    { $inc: { sequence: 1 } },
    { upsert: true, new: true }
  );
  return counter.sequence;
}

async function listProducts() {
  const products = await Product.find().sort({ pid: 1 }).lean();
  return { items: products.map(productReply) };
}

async function getProduct({ pid }) {
  const product = await Product.findOne({ pid: requireInteger(pid, 'pid') }).lean();
  if (!product) throw Object.assign(new Error('product not found'), { status: 404 });
  return productReply(product);
}

async function createProduct(request) {
  const product = await Product.create({
    pid: await nextProductId(),
    pname: requireText(request.pname, 'pname', 100),
    price: Number(request.price),
    quantity: requireInteger(request.quantity, 'quantity', 0)
  });
  return productReply(product);
}

async function updateProduct(request) {
  const data = {};
  if (request.pname) data.pname = requireText(request.pname, 'pname', 100);
  if (request.price !== undefined) {
    if (!Number.isFinite(Number(request.price)) || Number(request.price) < 0) {
      throw Object.assign(new Error('price must be a non-negative number'), { status: 400 });
    }
    data.price = Number(request.price);
  }
  if (request.quantity !== undefined) data.quantity = requireInteger(request.quantity, 'quantity', 0);
  if (!Object.keys(data).length) throw Object.assign(new Error('at least one product field is required'), { status: 400 });
  const product = await Product.findOneAndUpdate(
    { pid: requireInteger(request.pid, 'pid') },
    { $set: data },
    { new: true, runValidators: true }
  );
  if (!product) throw Object.assign(new Error('product not found'), { status: 404 });
  return productReply(product);
}

async function deleteProduct({ pid }) {
  const result = await Product.deleteOne({ pid: requireInteger(pid, 'pid') });
  if (!result.deletedCount) throw Object.assign(new Error('product not found'), { status: 404 });
  return {};
}

async function reserveInventory(request) {
  const pid = requireInteger(request.pid, 'pid');
  const quantity = requireInteger(request.quantity, 'quantity');
  const reservationId = requireText(request.reservation_id, 'reservation_id', 100);
  const existing = await Reservation.findOne({ reservation_id: reservationId }).lean();
  if (existing) {
    if (existing.pid !== pid || existing.quantity !== quantity || existing.status === 'RELEASED') {
      throw Object.assign(new Error('reservation id has already been used'), { status: 409 });
    }
    return getProduct({ pid });
  }

  try {
    await Reservation.create({ reservation_id: reservationId, pid, quantity, status: 'RESERVED' });
  } catch (error) {
    if (error.code === 11000) throw Object.assign(new Error('reservation id already exists'), { status: 409 });
    throw error;
  }

  const product = await Product.findOneAndUpdate(
    { pid, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity } },
    { new: true }
  );
  if (product) return productReply(product);

  await Reservation.deleteOne({ reservation_id: reservationId, status: 'RESERVED' });
  if (!(await Product.exists({ pid }))) throw Object.assign(new Error('product not found'), { status: 404 });
  throw Object.assign(new Error('insufficient stock'), { status: 409 });
}

async function releaseInventory({ reservation_id }) {
  const reservationId = requireText(reservation_id, 'reservation_id', 100);
  const reservation = await Reservation.findOneAndUpdate(
    { reservation_id: reservationId, status: 'RESERVED' },
    { $set: { status: 'RELEASED' } },
    { new: true }
  );
  if (!reservation) return {};
  await Product.updateOne({ pid: reservation.pid }, { $inc: { quantity: reservation.quantity } });
  return {};
}

async function commitReservation({ reservation_id }) {
  await Reservation.updateOne(
    { reservation_id: requireText(reservation_id, 'reservation_id', 100), status: 'RESERVED' },
    { $set: { status: 'COMMITTED' } }
  );
  return {};
}

async function initialize() {
  await Product.init();
  await Reservation.init();
  for (const product of [
    { pname: 'Demo Notebook', price: 4.5, quantity: 20 },
    { pname: 'Demo Pen', price: 1.25, quantity: 50 }
  ]) {
    const existing = await Product.findOne({ pname: product.pname });
    if (!existing) {
      await Product.create({ ...product, pid: await nextProductId() });
    }
  }
}

function handlers() {
  return {
    ListProducts: listProducts,
    GetProduct: getProduct,
    CreateProduct: createProduct,
    UpdateProduct: updateProduct,
    DeleteProduct: deleteProduct,
    ReserveInventory: reserveInventory,
    CommitReservation: commitReservation,
    ReleaseInventory: releaseInventory,
    Health: async () => {
      await Product.db.db.admin().ping();
      return { status: 'UP' };
    }
  };
}

module.exports = { handlers, initialize };
