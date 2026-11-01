const path = require('node:path');
const { loadService } = require('../services/shared/grpc');

for (const [proto, namespace, service] of [
  ['auth.proto', 'ecommerce.auth.v1', 'AuthService'],
  ['customer.proto', 'ecommerce.customer.v1', 'CustomerService'],
  ['product.proto', 'ecommerce.product.v1', 'ProductService'],
  ['order.proto', 'ecommerce.order.v1', 'OrderService'],
  ['shipment.proto', 'ecommerce.shipment.v1', 'ShipmentService']
]) {
  const definition = loadService(proto, namespace, service);
  if (!definition.service || !Object.keys(definition.service).length) {
    throw new Error(`${path.basename(proto)} does not define ${service}`);
  }
  console.log(`${proto}: ${Object.keys(definition.service).length} RPC methods valid`);
}
