# Prompt 3 — Requirements and assumptions

## Scope from the prompt and design sheets

### System-level

- Provide REST/JSON APIs through an API Gateway; route internal synchronous calls through gRPC.
- Use Node.js and a microservice architecture with DDD bounded contexts and database-per-service.
- Protect accounts with bcrypt-hashed passwords, JWT authentication, and role-based authorization.
- Gateway responsibilities: routing, JWT validation, authorization, rate limiting, request logging, and Redis-backed cache/session/token-revocation data.
- Use Kafka for asynchronous `OrderCreated` delivery to Shipment Service.
- Support health checks and local Docker Compose operation.

### Bounded contexts and data ownership

| Context/service | Owned data store | Responsibilities |
|---|---|---|
| Identity & Access / Auth Service | PostgreSQL: `User(uid, username, password, roleid)` and `Role` | Register member accounts, login, issue JWT, internal registration compensation |
| Customer & Membership / Customer Service | MongoDB: `Customer(uid, fullname, age, address, mid)` and `Membership(mid, mname, score)` | Customer CRUD, membership/score lookup and admin maintenance |
| Product Catalog / Product Service | MongoDB: `Product(pid, pname, price, quantity)` plus inventory reservations | Product CRUD, availability, atomic stock reserve/release |
| Order Management / Order Service | PostgreSQL: `Order`, `OrderDetail`, `OutboxEvent` | Discount, order persistence, inventory orchestration, transactional Outbox |
| Shipment / Shipment Service | MongoDB: `Shipment`, status history, rejected-event records | Idempotently create shipment from Kafka and update/read delivery status |
| API Gateway | Redis | JWT revocation, IP rate-limit counters, short-lived product-list cache |

No service may query another service's database directly. Order talks to Customer/Product using gRPC; it publishes events through Kafka instead of writing Shipment data.

## Functional requirements

| ID | Requirement | Main acceptance evidence |
|---|---|---|
| FR01 | Register an account | Valid registration creates a member and returns `201`; duplicate username/email returns `409`; password is bcrypt-hashed |
| FR02 | Login | Correct credentials return a signed JWT containing subject and role; invalid credentials return `401` |
| FR03 | Manage own account profile | Customer profile can be read; personal profile updates are authorized |
| FR04 | Manage customer and membership | Customer profile and membership score are held in Customer Service; Admin can manage customer/membership |
| FR05 | Manage products | Admin can create, update, delete products |
| FR06 | View product and inventory | Authenticated users can list/read price and available quantity |
| FR07 | Place orders | Authenticated member supplies product IDs/quantities; order and details are persisted |
| FR08 | Calculate discount | Order Service obtains membership score and stores the chosen score-tier percentage and calculated amount |
| FR09 | Update stock | Successful order reserves each product quantity; insufficient stock does not commit an order |
| FR10 | View orders | Member sees own orders; Admin may view all orders |
| FR11 | Manage shipment | `OrderCreated` is consumed asynchronously; authorized staff/admin changes valid status |
| FR12 | View shipment status | Owner, Admin, or Shipment Staff may see shipment status |
| FR13 | Authorize actions | Gateway rejects missing/invalid/revoked JWT with `401`, disallowed role with `403` |

## Role policy

| Operation | member | admin | shipment_staff |
|---|---:|---:|---:|
| Register/login | Yes | Seeded account | Seeded account |
| Read product list/item | Yes | Yes | Yes |
| Product create/update/delete | No | Yes | No |
| Read customer(s)/membership | Yes | Yes | No |
| Customer create/update/delete and membership score change | No | Yes | No |
| Place order | Yes | No | No |
| Read own order | Yes | Yes (all) | No |
| Read own shipment | Yes | Yes | Yes |
| Change shipment status | No | Yes | Yes |

This adopts the explicit Prompt 3 Customer Service rule that only Admin may create/update/delete customer records. Registration uses a trusted internal gRPC operation to provision the new account's initial profile.

## Non-functional requirements

- Health reports API Gateway, Redis, and all five gRPC services; individual databases/services expose gRPC health methods for container checks.
- Rate-limit and token-revocation store failures fail closed with `503`.
- Use parameterized PostgreSQL queries, validated MongoDB documents, bounded request payloads, and no credential/token logging.
- Inventory reservation uses an atomic conditional MongoDB update. If order persistence fails, Order Service compensates with an idempotent release.
- PostgreSQL Order, OrderDetail, and Outbox rows commit in one transaction. Outbox retries publishing; Shipment deduplicates by order ID.
- The Compose stack uses separate database instances/volumes for each owning service.

## Explicit MVP assumptions

The supplied sheets state that discount depends on score but do not define the formula. The selected MVP assumption is:

| Membership score | Discount percentage |
|---:|---:|
| 0–99 | 0% |
| 100–499 | 5% |
| 500 or more | 10% |

`Order.discount` stores the percentage. `discount_amount` stores the calculated currency amount. This assumption must be replaced if the instructor supplies a formal policy.

Shipment statuses are `PENDING → SHIPPING → DELIVERED`; `PENDING` or `SHIPPING` may transition to `CANCELLED`. Terminal statuses cannot transition again. The Kafka topic is `order-created`.
