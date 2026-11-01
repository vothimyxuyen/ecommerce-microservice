const { call, createClient, loadService } = require('../services/shared/grpc');

const [proto, packageName, serviceName, port] = process.argv.slice(2);
if (![proto, packageName, serviceName, port].every(Boolean)) {
  throw new Error('usage: node scripts/grpc-healthcheck.js <proto> <package> <service> <port>');
}

const Service = loadService(proto, packageName, serviceName);
const client = createClient(Service, `127.0.0.1:${port}`);

call(client, 'Health', {}, 2500)
  .then((response) => {
    client.close();
    if (response.status !== 'UP') process.exitCode = 1;
  })
  .catch((error) => {
    client.close();
    console.error('gRPC health check failed:', error.message);
    process.exitCode = 1;
  });
