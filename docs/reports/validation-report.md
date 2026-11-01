# Validation report

Last verified against the local Docker Compose stack. No credential values are recorded in this report.

| Check | Status | Evidence |
|---|---|---|
| Project structure and service ownership | Pass | Gateway, five gRPC services, three separate MongoDB databases, two separate PostgreSQL databases, Redis and Kafka are defined in `docker-compose.yml`. |
| Local environment safety and project separation | Pass | P3 `.env` is ignored and untracked. P1/P2/P3 API host ports are 3001/3002/3003; their configured service ports do not collide. Secret/password values are distinct across the three local `.env` files; values intentionally omitted. |
| Dependency lock and install | Pass | `npm install --package-lock-only` and `npm ci` completed; npm reported 0 vulnerabilities. |
| Unit and contract tests | Pass | `npm test`: 8 passed, 0 failed. Includes all five loaded gRPC service contracts and serialization of `UpdateMembershipRequest.mid`. |
| Proto validation | Pass | `npm run proto:check`: 5 proto files load, with 4/9/9/4/4 RPC methods respectively. |
| Postman collection syntax | Pass | Collection parses as valid JSON. The collection is prepared for REST flows; it was not executed in the Postman UI during this validation. |
| Docker Compose configuration | Pass | `docker compose config --quiet` exited successfully. |
| Docker image build and health | Pass | `docker compose up --build -d --wait` completed; `docker compose ps` showed 13/13 containers healthy, including the API Gateway aggregate health check. |
| API smoke workflow | Pass | `npm run test:smoke`: registration/duplicate and invalid auth cases, login/JWT/logout, RBAC, customer/product read/write, membership score 150, 5% discount, idempotent order, no-token rejection, order details, inventory rollback after partial multi-product reservation, Kafka-to-shipment flow and shipment status rules all passed. |
| Database ownership and stored results | Pass | CLI queries confirmed bcrypt hashes in Auth PostgreSQL; Order/OrderDetail and published Outbox rows in Order PostgreSQL; Customer/Membership, Product/inventory reservations and Shipment/history in their respective MongoDB databases. Order 2 stored subtotal 25.00, discount 5%, discount amount 1.25 and total 23.75; the failed multi-product order left quantities unchanged. |
| Kafka invalid/duplicate event handling | Pass | A malformed OrderCreated event was stored in the shipment failed-event collection. Re-publishing the valid event for an existing order left exactly one shipment and the existing three-entry status history unchanged. |

## Test-case coverage

All 25 design cases are mapped in `../test/test-plan.md`. The core REST/business and shipment lifecycle cases were exercised by `npm run test:smoke`; invalid and duplicate Kafka events were exercised separately with a local Kafka producer and confirmed through MongoDB CLI. This is local verification, not a claim that a GitHub Actions workflow or a shared Postman collection run has taken place.

The additional failure-mode checks listed at the end of the test plan (Redis outage, downstream outage and rate-limit exhaustion) were not part of this run.

## Issues found and corrected during validation

- Corrected the gRPC helper to resolve the root `proto/` directory as a filesystem path; the initial Docker build exposed a module-resolution failure.
- Added `mid` to `UpdateMembershipRequest`; end-to-end testing showed protobuf serialization had discarded the membership id, returning HTTP 400.
- Added a contract test to prevent the missing request field from recurring.
- Expanded the smoke test to reserve one product before intentionally failing a later reservation, then assert compensation restores both quantities.
