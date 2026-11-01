require('dotenv').config();

const mongoose = require('mongoose');
const { Kafka } = require('kafkajs');
const { closeServer, createServer, listen, loadService } = require('../../shared/grpc');
const { connectMongo } = require('../../shared/mongo');
const { FailedEvent, Shipment } = require('./models');
const { consumeOrderCreated, handlers } = require('./service');

const topic = process.env.KAFKA_TOPIC_ORDER_CREATED || 'order-created';
let consumer;
let kafkaConnected = false;

async function startConsumer() {
  const kafka = new Kafka({
    clientId: 'shipment-service',
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(',').map((value) => value.trim())
  });
  consumer = kafka.consumer({ groupId: 'shipment-service' });
  consumer.on(consumer.events.DISCONNECT, () => {
    kafkaConnected = false;
  });
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: true });
  kafkaConnected = true;
  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString() || '';
      let event;
      try {
        try {
          event = JSON.parse(raw);
        } catch {
          throw Object.assign(new Error('invalid JSON in OrderCreated event'), { code: 'INVALID_EVENT' });
        }
        await consumeOrderCreated(event);
      } catch (error) {
        if (error.code !== 'INVALID_EVENT') throw error;
        console.error('Shipment rejected OrderCreated event:', error.message);
        try {
          await FailedEvent.updateOne(
            { event_id: error.eventId || `invalid-${message.offset}` },
            { $setOnInsert: { payload: event || { raw }, error: error.message } },
            { upsert: true }
          );
        } catch (recordError) {
          console.error('Failed to record rejected shipment event:', recordError);
          throw recordError;
        }
      }
    }
  });
}

async function start() {
  await connectMongo(process.env.SHIPMENT_MONGODB_URI);
  await Shipment.init();
  await FailedEvent.init();
  await startConsumer();
  const Service = loadService('shipment.proto', 'ecommerce.shipment.v1', 'ShipmentService');
  const server = createServer(Service, handlers(() => kafkaConnected));
  await listen(server, '0.0.0.0:50055');
  closeServer(server, [
    { close: () => consumer?.disconnect() },
    { close: () => mongoose.disconnect() }
  ]);
}

start().catch((error) => {
  console.error('Shipment Service failed to start:', error);
  process.exit(1);
});
