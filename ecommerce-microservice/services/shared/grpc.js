const path = require('node:path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const PROTO_ROOT = path.resolve(__dirname, '../../proto');
const LOADER_OPTIONS = {
  keepCase: true,
  longs: Number,
  enums: String,
  defaults: true,
  oneofs: true
};

function loadService(protoFile, packageName, serviceName) {
  const definition = protoLoader.loadSync(`${PROTO_ROOT}/${protoFile}`, LOADER_OPTIONS);
  const namespace = packageName.split('.').reduce((value, part) => value[part], grpc.loadPackageDefinition(definition));
  return namespace[serviceName];
}

function createClient(Service, address) {
  return new Service(address, grpc.credentials.createInsecure());
}

function call(client, method, request, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    client[method](request, { deadline: new Date(Date.now() + timeoutMs) }, (error, response) => {
      if (error) return reject(error);
      return resolve(response);
    });
  });
}

function unary(handler) {
  return (call, callback) => {
    Promise.resolve(handler(call.request, call))
      .then((response) => callback(null, response || {}))
      .catch((error) => {
        const code = Number.isInteger(error.grpcCode) ? error.grpcCode :
          Number.isInteger(error.status) ? httpToGrpc(error.status) : grpc.status.INTERNAL;
        callback({ code, message: error.message || 'internal service error' });
      });
  };
}

function httpToGrpc(status) {
  return ({
    400: grpc.status.INVALID_ARGUMENT,
    401: grpc.status.UNAUTHENTICATED,
    403: grpc.status.PERMISSION_DENIED,
    404: grpc.status.NOT_FOUND,
    409: grpc.status.ALREADY_EXISTS,
    429: grpc.status.RESOURCE_EXHAUSTED,
    503: grpc.status.UNAVAILABLE
  })[status] || grpc.status.INTERNAL;
}

function createServer(Service, handlers) {
  const server = new grpc.Server();
  server.addService(Service.service, Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [name, unary(handler)])
  ));
  return server;
}

function listen(server, address) {
  return new Promise((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) return reject(error);
      server.start();
      console.log(`gRPC service listening on ${address} (bound port ${port})`);
      return resolve(server);
    });
  });
}

function closeServer(server, dependencies = []) {
  const shutdown = () => {
    server.tryShutdown(async () => {
      for (const dependency of dependencies) {
        try {
          await dependency.close();
        } catch (error) {
          console.error('Failed to close service dependency:', error);
          process.exitCode = 1;
        }
      }
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { call, closeServer, createClient, createServer, grpc, listen, loadService };
