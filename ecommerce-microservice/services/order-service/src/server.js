require('dotenv').config();

const { Kafka } = require('kafkajs');
const { closeServer, createServer, listen, loadService } = require('../../shared/grpc');
const { close, handlers, initialize } = require('./service');

async function start() {
  const kafka = new Kafka({
    clientId: 'order-service',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map((value) => value.trim())
  });
  await initialize(kafka);
  const Service = loadService('order.proto', 'ecommerce.order.v1', 'OrderService');
  const server = createServer(Service, handlers());
  await listen(server, '0.0.0.0:50054');
  closeServer(server, [{ close }]);
}

start().catch((error) => {
  console.error('Order Service failed to start:', error);
  process.exit(1);
});
