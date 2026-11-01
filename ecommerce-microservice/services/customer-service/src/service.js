const { Customer, Membership } = require('./models');
const { requireInteger, requireText } = require('../../shared/validation');

function customerReply(customer) {
  return {
    uid: customer.uid,
    fullname: customer.fullname,
    age: customer.age,
    address: customer.address,
    mid: customer.mid
  };
}

async function ensureCustomer(request) {
  const uid = requireInteger(request.uid, 'uid');
  const fullname = requireText(request.fullname, 'fullname', 100);
  const age = Number.isSafeInteger(request.age) && request.age >= 0 ? request.age : 0;
  const address = typeof request.address === 'string' ? request.address.trim().slice(0, 255) : '';
  await Membership.updateOne(
    { mid: 1 },
    { $setOnInsert: { mid: 1, mname: 'Basic', score: 10 } },
    { upsert: true }
  );
  const customer = await Customer.findOneAndUpdate(
    { uid },
    { $setOnInsert: { uid, fullname, age, address, mid: 1 } },
    { upsert: true, new: true, runValidators: true }
  );
  return customerReply(customer);
}

async function getCustomer({ uid }) {
  const customer = await Customer.findOne({ uid: requireInteger(uid, 'uid') }).lean();
  if (!customer) throw Object.assign(new Error('customer not found'), { status: 404 });
  return customerReply(customer);
}

async function listCustomers() {
  const customers = await Customer.find().sort({ uid: 1 }).lean();
  return { items: customers.map(customerReply) };
}

async function createCustomer(request) {
  const mid = requireInteger(request.mid || 1, 'mid');
  if (!(await Membership.exists({ mid }))) {
    throw Object.assign(new Error('membership not found'), { status: 404 });
  }
  const customer = await Customer.create({
    uid: requireInteger(request.uid, 'uid'),
    fullname: requireText(request.fullname, 'fullname', 100),
    age: requireInteger(request.age, 'age', 0),
    address: typeof request.address === 'string' ? request.address.trim() : '',
    mid
  });
  return customerReply(customer);
}

async function updateCustomer(request) {
  const data = {};
  if (Object.hasOwn(request, 'fullname')) data.fullname = requireText(request.fullname, 'fullname', 100);
  if (Object.hasOwn(request, 'age')) data.age = requireInteger(request.age, 'age', 0);
  if (Object.hasOwn(request, 'address')) {
    if (typeof request.address !== 'string' || request.address.length > 255) {
      throw Object.assign(new Error('address must be at most 255 characters'), { status: 400 });
    }
    data.address = request.address.trim();
  }
  if (Object.hasOwn(request, 'mid')) {
    data.mid = requireInteger(request.mid, 'mid');
    if (!(await Membership.exists({ mid: data.mid }))) {
      throw Object.assign(new Error('membership not found'), { status: 404 });
    }
  }
  if (!Object.keys(data).length) throw Object.assign(new Error('at least one customer field is required'), { status: 400 });
  const customer = await Customer.findOneAndUpdate(
    { uid: requireInteger(request.uid, 'uid') },
    { $set: data },
    { new: true, runValidators: true }
  );
  if (!customer) throw Object.assign(new Error('customer not found'), { status: 404 });
  return customerReply(customer);
}

async function deleteCustomer({ uid }) {
  const result = await Customer.deleteOne({ uid: requireInteger(uid, 'uid') });
  if (!result.deletedCount) throw Object.assign(new Error('customer not found'), { status: 404 });
  return {};
}

async function getMembership({ uid }) {
  const customer = await Customer.findOne({ uid: requireInteger(uid, 'uid') }).lean();
  if (!customer) throw Object.assign(new Error('customer not found'), { status: 404 });
  const membership = await Membership.findOne({ mid: customer.mid }).lean();
  if (!membership) throw Object.assign(new Error('membership not found'), { status: 404 });
  return { mid: membership.mid, mname: membership.mname, score: membership.score };
}

async function updateMembership(request) {
  const uid = requireInteger(request.uid, 'uid');
  const customer = await Customer.findOne({ uid });
  if (!customer) throw Object.assign(new Error('customer not found'), { status: 404 });
  const mid = requireInteger(request.mid, 'mid');
  const mname = requireText(request.mname, 'mname', 50);
  const score = requireInteger(request.score, 'score', 0);
  await Membership.updateOne({ mid }, { $set: { mid, mname, score } }, { upsert: true, runValidators: true });
  customer.mid = mid;
  await customer.save();
  return { mid, mname, score };
}

async function initialize() {
  await Membership.updateOne(
    { mid: 1 },
    { $setOnInsert: { mid: 1, mname: 'Basic', score: 10 } },
    { upsert: true }
  );
}

function handlers() {
  return {
    EnsureCustomer: ensureCustomer,
    GetCustomer: getCustomer,
    ListCustomers: listCustomers,
    CreateCustomer: createCustomer,
    UpdateCustomer: updateCustomer,
    DeleteCustomer: deleteCustomer,
    GetMembership: getMembership,
    UpdateMembership: updateMembership,
    Health: async () => {
      await Customer.db.db.admin().ping();
      return { status: 'UP' };
    }
  };
}

module.exports = { handlers, initialize };
