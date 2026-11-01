# Ecommerce Microservices MVP

## Project boundaries

- This directory is the complete Prompt 3 project. Do not put source, secrets, dependencies, generated files, or workflows at the parent repository root.
- Keep Auth, Customer, Product, Order, and Shipment as separate bounded contexts and deployable services. API Gateway is the only public HTTP entry point.
- Client-to-gateway traffic is REST/JSON. Gateway-to-service traffic is gRPC. Order-to-Customer/Product is gRPC. Order-to-Shipment is asynchronous through Kafka.
- Each service owns its database. Never read or write another service's database directly.
- Keep account credentials and roles in Auth PostgreSQL; customer and membership documents in Customer MongoDB; products and inventory reservations in Product MongoDB; orders, details, and the Outbox in Order PostgreSQL; shipments in Shipment MongoDB. Redis belongs to the gateway.
- Store local secrets in `.env`; commit only `.env.example`. Never log passwords, JWTs, or database URLs.

## Working agreement

1. Read `docs/requirements/requirements.md`, `docs/architecture/architecture.md`, the relevant API specification, and the related test cases before changing behavior.
2. Use the BA, Dev, and Test custom agents in `.claude/agents/` for their bounded roles. The BA agent reports acceptance criteria; the Dev agent implements only the approved scope; the Test agent verifies the criteria independently.
3. Work one numbered README step at a time. After each step, run its stated check and report command/output evidence, pass/fail, and any remaining gap before moving on.
4. Do not invent business rules. The only current explicit assumption is the score-to-discount tier in `docs/architecture/architecture.md`; ask before changing it.
5. Preserve database-per-service and REST/gRPC/Kafka boundaries. Do not create a shared database, add direct service HTTP calls, or expose internal gRPC ports to the host without an explicit requirement.
6. Add or update tests and documentation with each behavior change. Do not claim an end-to-end check passed unless the Compose stack and the corresponding request actually ran.
7. Do not use destructive Compose volume commands against a student's data without warning and explicit approval.

## Commands

Run from this project directory:

```sh
npm ci
npm test
npm run proto:check
docker compose config --quiet
docker compose up --build -d --wait
```

See `README.md` for setup, the step-by-step self-assessment, API/Postman flows, database CLI checks, and safe shutdown.
