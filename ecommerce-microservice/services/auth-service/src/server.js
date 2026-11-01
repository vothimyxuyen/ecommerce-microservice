require('dotenv').config();

const path = require('node:path');
const { closeServer, createServer, listen, loadService } = require('../../shared/grpc');
const { handlers, initialize, pool } = require('./service');

async function start() {
  await initialize();
  const Service = loadService('auth.proto', 'ecommerce.auth.v1', 'AuthService');
  const server = createServer(Service, handlers());
  await listen(server, '0.0.0.0:50051');
  closeServer(server, [{ close: () => pool.end() }]);
}

start().catch((error) => {
  console.error('Auth Service failed to start:', error);
  process.exit(1);
});
