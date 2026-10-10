const Product = require('../models/product');

function sendProductError(error, res, next) {
  if (error.code === 11000) {
    return res.status(409).json({ error: 'pid already exists' });
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ error: error.message });
  }
  return next(error);
}

async function create(req, res, next) {
  try {
    const product = await Product.create(req.body);
    return res.status(201).json(product);
  } catch (error) {
    return sendProductError(error, res, next);
  }
}

async function list(_req, res, next) {
  try {
    return res.json(await Product.find().sort({ pid: 1 }));
  } catch (error) {
    return next(error);
  }
}

async function get(req, res, next) {
  try {
    const product = await Product.findOne({ pid: req.params.pid });
    if (!product) return res.status(404).json({ error: 'product not found' });
    return res.json(product);
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const product = await Product.findOneAndUpdate(
      { pid: req.params.pid },
      req.body,
      { new: true, runValidators: true, overwrite: true }
    );
    if (!product) return res.status(404).json({ error: 'product not found' });
    return res.json(product);
  } catch (error) {
    return sendProductError(error, res, next);
  }
}

async function remove(req, res, next) {
  try {
    const product = await Product.findOneAndDelete({ pid: req.params.pid });
    if (!product) return res.status(404).json({ error: 'product not found' });
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
}

module.exports = { create, get, list, remove, update };
