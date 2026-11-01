# Verification plan — 25 design test cases

The attached design lists 25 tests across five bounded contexts. Run unit/proto tests first, then the complete API flow with `npm run test:smoke`, and inspect service databases/Kafka with the CLI commands in `README.md`.

| ID | Scenario | Expected result | Verification |
|---|---|---|---|
| TC-IAM-01 | Register valid account | 201, member account and profile | `npm run test:smoke` |
| TC-IAM-02 | Duplicate username | 409 | `npm run test:smoke` |
| TC-IAM-03 | Missing password | 400 | `npm run test:smoke` |
| TC-IAM-04 | Login valid credentials | JWT returned | `npm run test:smoke` |
| TC-IAM-05 | Wrong password | 401 | `npm run test:smoke` |
| TC-CUS-01 | Read existing customer | 200 profile | `npm run test:smoke` |
| TC-CUS-02 | Read absent customer | 404 | `npm run test:smoke` |
| TC-CUS-03 | Admin updates fullname | 200 updated profile | `npm run test:smoke` |
| TC-CUS-04 | Read membership | Membership and score returned | `npm run test:smoke` |
| TC-CUS-05 | Read customer without token | 401 | `npm run test:smoke` |
| TC-PRO-01 | List products | Product list returned | `npm run test:smoke` |
| TC-PRO-02 | Read existing product | Product returned | `npm run test:smoke` |
| TC-PRO-03 | Read absent product | 404 | `npm run test:smoke` |
| TC-PRO-04 | Admin creates product | 201 product | `npm run test:smoke` |
| TC-PRO-05 | Admin updates stock | Exact quantity returned | `npm run test:smoke` |
| TC-ORD-01 | Place valid order | Order and details persisted | `npm run test:smoke` + database CLI |
| TC-ORD-02 | Place order without JWT | 401 | `npm run test:smoke` |
| TC-ORD-03 | Quantity above stock | 409; no committed order; stock restored | `npm run test:smoke` |
| TC-ORD-04 | Calculate discount from score | Tier percentage and amount match policy | unit tests + `npm run test:smoke` |
| TC-ORD-05 | Publish order event | OrderCreated Outbox row published to Kafka | `npm run test:smoke` + PostgreSQL/Kafka CLI |
| TC-SHP-01 | Consume valid event | One PENDING shipment created | `npm run test:smoke` |
| TC-SHP-02 | Event missing oid | No shipment; rejected event recorded | Manual Kafka integration; see validation report |
| TC-SHP-03 | Update status to SHIPPING | Status and history updated | `npm run test:smoke` |
| TC-SHP-04 | Update missing shipment | 404 | `npm run test:smoke` |
| TC-SHP-05 | Deliver duplicate event | No duplicate shipment | Manual Kafka integration; see validation report |

## Additional gateway/security checks

- Reject invalid/revoked JWT (`401`) and insufficient role (`403`).
- Exceed configured per-IP request limit (`429`); check rate-limit headers.
- Stop Redis: gateway rate-limited/protected operations fail closed (`503`).
- Stop a downstream gRPC service: health becomes `503` and dependent requests return an explicit gateway error.
- Retry an OrderCreated event: unique order ID prevents duplicate Shipment.
- Force Kafka publishing failure: committed Outbox row remains pending and is published after Kafka returns.
