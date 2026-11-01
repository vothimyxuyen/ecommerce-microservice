require('dotenv').config();

const mongoose = require('mongoose');
const { closeServer, createServer, listen, loadService } = require('../../shared/grpc');
const { connectMongo } = require('../../shared/mongo');
const { handlers, initialize } = require('./service');

async function start() {
  await connectMongo(process.env.PRODUCT_MONGODB_URI);
  await initialize();
  const Service = loadService('product.proto', 'ecommerce.product.v1', 'ProductService');
  const server = createServer(Service, handlers());
  await listen(server, '0.0.0.0:50053');
  closeServer(server, [{ close: () => mongoose.disconnect() }]);
}

start().catch((error) => {
  console.error('Product Service failed to start:', error);
  process.exit(1);
});
