require('dotenv').config();

const mongoose = require('mongoose');
const { closeServer, createServer, listen, loadService } = require('../../shared/grpc');
const { connectMongo } = require('../../shared/mongo');
const { handlers, initialize } = require('./service');

async function start() {
  await connectMongo(process.env.CUSTOMER_MONGODB_URI);
  await initialize();
  const Service = loadService('customer.proto', 'ecommerce.customer.v1', 'CustomerService');
  const server = createServer(Service, handlers());
  await listen(server, '0.0.0.0:50052');
  closeServer(server, [{ close: () => mongoose.disconnect() }]);
}

start().catch((error) => {
  console.error('Customer Service failed to start:', error);
  process.exit(1);
});
