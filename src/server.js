const app = require('./app');
const { getConfig } = require('./config');

const { port } = getConfig();

async function start() {
  await prisma.$connect();
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Product API listening on port ${port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const prisma = require('./prisma');

start().catch((error) => {
  console.error('Failed to start Product API:', error);
  process.exit(1);
});
