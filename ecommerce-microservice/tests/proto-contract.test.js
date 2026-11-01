const test = require('node:test');
const assert = require('node:assert/strict');
const { loadService } = require('../services/shared/grpc');

const contracts = [
  ['auth.proto', 'ecommerce.auth.v1', 'AuthService', ['Register', 'Login', 'DeleteUser', 'Health']],
  ['customer.proto', 'ecommerce.customer.v1', 'CustomerService', ['EnsureCustomer', 'GetCustomer', 'ListCustomers', 'CreateCustomer', 'UpdateCustomer', 'DeleteCustomer', 'GetMembership', 'UpdateMembership', 'Health']],
  ['product.proto', 'ecommerce.product.v1', 'ProductService', ['ListProducts', 'GetProduct', 'CreateProduct', 'UpdateProduct', 'DeleteProduct', 'ReserveInventory', 'CommitReservation', 'ReleaseInventory', 'Health']],
  ['order.proto', 'ecommerce.order.v1', 'OrderService', ['CreateOrder', 'ListOrders', 'GetOrder', 'Health']],
  ['shipment.proto', 'ecommerce.shipment.v1', 'ShipmentService', ['GetShipment', 'GetShipmentByOrder', 'UpdateShipmentStatus', 'Health']]
];

for (const [proto, namespace, service, methods] of contracts) {
  test(`${proto} exposes the expected ${service} RPC contract`, () => {
    const definition = loadService(proto, namespace, service);
    for (const method of methods) {
      assert.ok(definition.service[method], `${service}.${method} is missing`);
    }
    if (proto === 'customer.proto') {
      const update = definition.service.UpdateMembership.requestDeserialize(
        definition.service.UpdateMembership.requestSerialize({ uid: 1, mname: 'Silver', score: 150, mid: 2 })
      );
      assert.equal(update.mid, 2, 'UpdateMembershipRequest must transmit the membership id');
    }
  });
}
