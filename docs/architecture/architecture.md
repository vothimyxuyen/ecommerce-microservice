# Architecture — Ecommerce Microservices MVP

## Runtime topology

```text
Client -- REST/JSON --> API Gateway -- gRPC --> Auth Service ---- Auth PostgreSQL
                              |                 Customer Service - Customer MongoDB
                              |                 Product Service -- Product MongoDB
                              |                 Order Service --- Order PostgreSQL
                              |                    |                |
                              |                    +-- gRPC --------+ (Customer/Product)
                              |                    +-- Kafka Outbox --> Kafka --> Shipment Service -- Shipment MongoDB
                              +-- Redis (JWT revocation, IP rate limit, product-list cache)
```

Each service has its own schema/database instance and owns the associated migrations/documents. Gateway is the only port exposed for HTTP. Internal gRPC services and Kafka use the Compose network.

## Request boundaries

- The Gateway validates HS256 JWT signature, expiry, subject, role, and Redis revocation entry before protected routes. It enforces route roles and emits a request ID plus structured access log without credentials.
- Redis fixed-window counters enforce per-IP rate limiting. Redis caches product-list JSON with a short TTL and invalidates it after product writes.
- Gateway-to-service calls use the `.proto` contracts. Order Service also uses gRPC for Customer membership and Product inventory.
- Internal gRPC runs on a private Compose network; deployment beyond local MVP should add mTLS/service identity.

## Place-order sequence and consistency

1. Gateway authenticates a member and validates the request envelope.
2. Order Service validates/merges duplicate product lines and gets the customer's score from Customer Service.
3. Order Service computes the tier percentage and totals using integer cents.
4. For each distinct product, Order Service fetches current price/name and reserves stock with a conditional Product Service update and a unique reservation ID.
5. Order Service opens a PostgreSQL transaction, writes `Order`, `OrderDetail`, and `OrderCreated` `OutboxEvent`, then commits.
6. If the database transaction fails, Order Service releases each completed inventory reservation. Compensation errors are logged for operator action.
7. An Outbox publisher sends pending rows to Kafka and marks them published only after Kafka acknowledges. Failures leave the row pending for retry.
8. Shipment Service consumes the event and upserts by `oid`, so Kafka redelivery cannot create duplicate shipments. Invalid events are recorded; transient database errors are rethrown for retry.
9. Gateway returns `201` with order totals. Shipment creation is asynchronous; clients poll `GET /api/shipments/order/:oid`.

The PostgreSQL transaction does not span MongoDB/Kafka. Inventory compensation and the Outbox make the cross-service workflow recoverable; they are not a distributed ACID transaction.

## Storage contracts

- Auth PostgreSQL: `roles(roleid, rolename)`, `users(uid, username, password, roleid, email, phone, created_at)`.
- Customer MongoDB: Customer documents (`uid`, `fullname`, `age`, `address`, `mid`); Membership documents (`mid`, `mname`, `score`).
- Product MongoDB: Product documents (`pid`, `pname`, `price`, `quantity`); inventory-reservation documents with unique reservation IDs and lifecycle state.
- Order PostgreSQL: `orders(oid, uid, discount, subtotal, discount_amount, total_amount, request_key, reservation_id, created_at)`, `order_details(oid, pid, pname, qty, unit_price)`, and `outbox_events`.
- Shipment MongoDB: Shipment documents (`shipid`, unique `oid`, `uid`, `status`, items, history), counters, and rejected-event records.

## ADR — business and operational choices

1. **Score discount:** 0–99 → 0%, 100–499 → 5%, >=500 → 10% (MVP assumption documented in requirements).
2. **Registration role:** public registration always creates `member`; role is not trusted from request input. Admin and shipment staff are bootstrapped from local-only environment secrets.
3. **Customer provisioning:** Gateway calls an internal idempotent `EnsureCustomer` after Auth registration. If provisioning fails, Gateway compensates by deleting the newly registered member.
4. **Order delivery:** transactional Outbox + Kafka; shipment creation is asynchronous and idempotent by order ID.
5. **Databases:** separate Compose containers and named volumes per service to make database ownership observable and prevent accidental cross-service access.
6. **Security boundary:** shared HS256 secret is convenient for the teaching MVP; use asymmetric signing/key rotation and gRPC mTLS in production.
