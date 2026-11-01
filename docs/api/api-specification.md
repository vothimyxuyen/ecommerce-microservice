# REST API specification

Base URL: `http://localhost:3003`; JSON body; JWT-protected requests use `Authorization: Bearer <accessToken>`.

## Identity & Access

| Method/path | Auth | Success | Notes/errors |
|---|---|---|---|
| `POST /api/auth/register` | No | `201 {message, uid, role}` | Requires username/password; accepts email, phone, fullname, age, address; always creates `member`; duplicate username/email `409`; provisions Customer profile |
| `POST /api/auth/login` | No | `200 {accessToken, tokenType, expiresIn, uid, role}` | Invalid credentials `401` |
| `POST /api/auth/logout` | Any valid role | `200 {message}` | Adds JWT `jti` to Redis revocation set until expiry |

## Customer & Membership

| Method/path | Role | Success | Notes |
|---|---|---|---|
| `GET /api/customers` | member/admin | `200 {items}` | List customer profiles |
| `GET /api/customers/:uid` | member/admin | `200 Customer` | `404` when missing |
| `POST /api/customers` | admin | `201 Customer` | Body: `uid, fullname, age, address, mid` |
| `PUT /api/customers/:uid` | admin | `200 Customer` | Body: fields to update; invalid input `400` |
| `DELETE /api/customers/:uid` | admin | `200 {message, uid}` | `404` when missing |
| `GET /api/customers/:uid/membership` | member/admin | `200 {mid,mname,score}` | Score is owned by Customer Service |
| `PATCH /api/customers/:uid/membership` | admin | `200 {mid,mname,score}` | Body: `mid,mname,score` |

## Product Catalog

| Method/path | Role | Success | Notes |
|---|---|---|---|
| `GET /api/products` | member/admin/shipment_staff | `200 {items}` | Redis cache, short TTL |
| `GET /api/products/:pid` | member/admin/shipment_staff | `200 Product` | `404` when missing |
| `POST /api/products` | admin | `201 Product` | Body: `pname,price,quantity` |
| `PUT /api/products/:pid` | admin | `200 Product` | Body: `pname,price,quantity` |
| `DELETE /api/products/:pid` | admin | `200 {message,pid}` | `404` when missing |

## Orders and shipment

| Method/path | Role | Success | Notes |
|---|---|---|---|
| `POST /api/orders` | member | `201 Order` | Body: `{items:[{pid,qty}]}`; optional `Idempotency-Key`; missing product `404`; insufficient stock `409` |
| `GET /api/orders` | member/admin | `200 {items}` | Member sees own orders; admin sees all |
| `GET /api/orders/:oid` | owner/admin | `200 Order` | `403` for another member's order |
| `GET /api/shipments/order/:oid` | owner/admin/shipment_staff | `200 Shipment` | Poll after order; initially eventual/asynchronous |
| `GET /api/shipments/:shipid` | owner/admin/shipment_staff | `200 Shipment` | `404` when missing |
| `PATCH /api/shipments/:shipid/status` | admin/shipment_staff | `200 Shipment` | Body: `{status:"SHIPPING"}`; invalid transition `409` |
| `GET /api/health` | No | `200 {status:"UP",dependencies}` | `503` if Redis or a gRPC service is unhealthy |

Gateway returns `401` for absent, invalid, expired, or revoked JWT; `403` for a valid role without permission; `429` for rate limit; `502/503/504` for downstream failures. Every response includes the `x-request-id` header.

## gRPC contracts

Contracts live in `proto/`. `auth.proto` and `customer.proto` are the initial teaching contracts; Product, Order, and Shipment contracts keep each workflow boundary explicit. Internal services do not expose a public REST listener.
