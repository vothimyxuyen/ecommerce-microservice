# PROMPT 3 — Ecommerce Microservices MVP

Project Node.js theo Microservices, DDD bounded contexts, database-per-service, REST/JSON tại API Gateway, gRPC cho gọi đồng bộ nội bộ và Kafka cho sự kiện OrderCreated. Nội dung được xây từ use-case, functional requirements, API specification, 25 test cases, ERD và sơ đồ kiến trúc/sequence được cung cấp.

## Cấu trúc dự án

```text
ecommerce-microservice/
├── CLAUDE.md
├── .claude/agents/
│   ├── ba-agent.md
│   ├── dev-agent.md
│   └── test-agent.md
├── docs/
│   ├── requirements/         # FR, role policy, testable acceptance criteria
│   ├── architecture/         # Service boundaries, flows, assumptions/ADR
│   ├── api/                  # REST API and gRPC contract guide
│   ├── test/                 # Traceability for the 25 attached test cases
│   └── reports/              # Honest validation status/evidence
├── services/
│   ├── api-gateway/          # REST, JWT/RBAC, Redis cache/rate limit/logging
│   ├── auth-service/         # gRPC, bcrypt/JWT, Auth PostgreSQL
│   ├── customer-service/     # gRPC, Customer/Membership MongoDB
│   ├── product-service/      # gRPC, product + inventory MongoDB
│   ├── order-service/        # gRPC, Order/Detail/Outbox PostgreSQL, Kafka publisher
│   ├── shipment-service/     # gRPC, Kafka consumer, Shipment MongoDB
│   ├── shared/               # gRPC/server and validation helpers only
│   └── Dockerfile            # Same build recipe; separate per-service images
├── proto/                    # auth, customer, product, order, shipment
├── postman/collections/
├── scripts/                  # gRPC health, proto check, end-to-end smoke
├── tests/                    # Discount policy and gRPC contract tests
├── .env.example
├── docker-compose.yml
├── package.json
└── package-lock.json
```

`services/shared` chỉ chứa kỹ thuật dùng chung, không phải shared domain/database. Mỗi service chỉ truy cập datastore của chính nó.

## Hướng dẫn từng bước và tự đánh giá

Thực hiện đúng thứ tự. **Sau mỗi bước dừng lại, chạy kiểm tra, ghi bằng chứng Pass/Fail rồi mới sang bước tiếp.** Nếu lệnh sai, sửa nguyên nhân và chạy lại; không ghi “đạt” khi chưa có output xác nhận.

### Bước 1 — Mở đúng project và đọc thiết kế

Mở riêng thư mục `ecommerce-microservice` trong VS Code. Đọc:

1. `CLAUDE.md`
2. `docs/requirements/requirements.md`
3. `docs/architecture/architecture.md`
4. `docs/api/api-specification.md`
5. `docs/test/test-plan.md`
6. `.claude/agents/ba-agent.md`, `dev-agent.md`, `test-agent.md`

Trong Claude Code, bắt đầu bằng yêu cầu BA trước, ví dụ:

```text
Dùng ba-agent đọc yêu cầu P3 và đối chiếu đủ 25 test case. Chỉ báo acceptance criteria, mâu thuẫn và câu hỏi còn thiếu; chưa sửa code.
```

**Kiểm tra khách quan:** giải thích được Gateway, năm bounded contexts, datastore của từng service, gRPC đồng bộ và Kafka bất đồng bộ. Bảng FR/role và 25 test cases có trong docs. Nếu có quy tắc nghiệp vụ chưa được tài liệu xác định, ghi thành câu hỏi/assumption, không tự kết luận.

### Bước 2 — Tạo cấu hình môi trường riêng cho P3

Trong PowerShell mở ở project:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Sinh các giá trị **khác nhau** cho `JWT_SECRET`, `AUTH_DB_PASSWORD`, `ORDER_DB_PASSWORD`, `SEED_ADMIN_PASSWORD`, `SEED_SHIPMENT_PASSWORD`; cập nhật trong `.env`. Password DB chỉ dùng ký tự hex để an toàn khi nội suy vào URL Compose. Không dùng chung secret với P1/P2, không chép `.env` vào GitHub.

| Project | API | Database / broker ports trên host |
|---|---:|---|
| P1 `product-api` | 3001 | MongoDB 27018 |
| P2 `ecommerce-monolithic` | 3002 | PostgreSQL 5435 |
| P3 `ecommerce-microservice` | 3003 | Auth PG 5436, Order PG 5437, Customer Mongo 27019, Product Mongo 27020, Shipment Mongo 27021, Redis 6381, Kafka 9094 |

Các port là port host để kiểm tra bằng CLI; gRPC service ports chỉ dùng trong Docker network.

```powershell
git check-ignore -v .env
git ls-files -- .env
```

**Kiểm tra khách quan:** `.env` được ignore, không được Git track; các port P3 không trùng P1/P2; năm secret P3 khác nhau và JWT secret có ít nhất 32 ký tự. Không paste giá trị secret vào báo cáo/chat.

### Bước 3 — Cài package và xác thực business rule/proto

```powershell
npm ci
npm test
npm run proto:check
```

**Kiểm tra khách quan:** unit tests xanh; tất cả năm proto load được, có đủ RPC methods. Unit tests xác nhận score 0–99 → 0%, 100–499 → 5%, >=500 → 10%; đây là giả định MVP vì tài liệu chỉ nói “dựa trên score”, không nêu bảng quy đổi.

### Bước 4 — Dựng toàn bộ hệ thống bằng Docker Compose

```powershell
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

Lần build đầu tải Node, PostgreSQL, MongoDB, Redis và Kafka images; có thể mất vài phút. Compose khởi động năm API/service bounded contexts, ba MongoDB riêng, hai PostgreSQL riêng, Redis và Kafka.

**Kiểm tra khách quan:** lệnh config kết thúc exit code 0; `api-gateway`, năm gRPC services, Redis, Kafka, hai PostgreSQL và ba MongoDB đều `healthy`. Nếu service unhealthy, xem `docker compose logs --tail 100 <service>` trước khi tiếp tục.

### Bước 5 — Health check, routing, logs và rate limiting

```powershell
Invoke-RestMethod http://localhost:3003/api/health | ConvertTo-Json -Depth 5
docker compose ps
docker compose logs --tail 50 api-gateway
```

**Kiểm tra khách quan:** `/api/health` trả HTTP 200, `status: UP`, dependencies `redis`, `auth`, `customer`, `product`, `order`, `shipment` đều `UP`. Access log có method/path/status/duration/requestId và không có token, password. Rate limiter dùng IP trong Redis; có thể chỉnh `RATE_LIMIT_MAX` thấp để kiểm tra 429 rồi khôi phục giá trị.

### Bước 6 — Chạy luồng đăng ký, đăng nhập, CRUD và RBAC

Import `postman/collections/ecommerce-microservices-p3.postman_collection.json`, đặt `baseUrl` là `http://localhost:3003`. Đọc `SEED_ADMIN_PASSWORD` và `SEED_SHIPMENT_PASSWORD` trực tiếp trong local `.env`, nhập vào collection variables trong Postman; **không export/share collection kèm credentials**.

Chạy lần lượt: health → register member → member login → admin login → đổi score → tạo Product → đọc Customer/Membership/Product.

**Kiểm tra khách quan:**

- Đăng ký trả `201`, role là `member`; password trong Auth PostgreSQL là bcrypt hash.
- Đăng nhập trả JWT (`accessToken`); account/member profile nằm ở hai service/database riêng.
- Member đọc được customer/membership/product; member không được gọi API quản trị (403).
- Admin tạo/cập nhật/xóa Product hoặc Customer; tạo product trả `201`.

### Bước 7 — Đặt đơn, giảm giá, inventory và Outbox

Trong Postman chạy lần lượt request không token (kỳ vọng `401`) rồi request đặt hàng có member token. Với test score 150, giá 12.50, qty 2: discount 5%, subtotal 25.00, discount amount 1.25 và total 23.75. Dùng `GET /api/orders/:oid` để xem details.

**Kiểm tra khách quan:** Order và OrderDetail cùng được ghi trong Order PostgreSQL transaction; Product MongoDB giảm đúng 2; `outbox_events` có OrderCreated tương ứng. Đặt qty lớn hơn tồn kho trả `409`, không có Order được commit và phần tồn kho đã reserve trước đó được bù trả.

### Bước 8 — Xác nhận Kafka và Shipment

Đợi consumer tạo shipment rồi chạy Postman “Poll shipment for order”. Dùng shipment staff login; cập nhật lần lượt `SHIPPING`, rồi `DELIVERED`.

**Kiểm tra khách quan:** shipment ban đầu `PENDING`; sự kiện OrderCreated đến Kafka và được consumer xử lý; nhận lại cùng event không tạo shipment trùng theo `oid`; lịch sử trạng thái được lưu. Chỉ role `admin`/`shipment_staff` cập nhật status; trạng thái sai trả lỗi.

### Bước 9 — Đối chiếu dữ liệu bằng CLI trong database owners

```powershell
docker compose exec auth-postgres psql -U auth_user -d auth_db -c "SELECT u.uid,u.username,r.rolename,substring(u.password,1,2)=chr(36)||'2' AS bcrypt_hash FROM users u JOIN roles r USING(roleid);"
docker compose exec order-postgres psql -U order_user -d order_db -c "SELECT oid,uid,discount,subtotal,discount_amount,total_amount FROM orders ORDER BY oid DESC LIMIT 5;"
docker compose exec order-postgres psql -U order_user -d order_db -c "SELECT oid,pid,pname,qty,unit_price FROM order_details ORDER BY oid DESC,pid;"
docker compose exec order-postgres psql -U order_user -d order_db -c "SELECT event_type,aggregate_id,published_at,attempts FROM outbox_events ORDER BY created_at DESC LIMIT 5;"
docker compose exec customer-mongo mongosh customer_db --quiet --eval "db.customers.find().limit(5).forEach(printjson); db.memberships.find().forEach(printjson)"
docker compose exec product-mongo mongosh product_db --quiet --eval "db.products.find().limit(10).forEach(printjson); db.inventoryreservations.find().limit(10).forEach(printjson)"
docker compose exec shipment-mongo mongosh shipment_db --quiet --eval "db.shipments.find().limit(10).forEach(printjson); db.failedorderevents.find().forEach(printjson)"
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic order-created --from-beginning --max-messages 1
```

**Kiểm tra khách quan:** auth/order rows ở đúng PostgreSQL riêng; Customer/Product/Shipment documents ở đúng MongoDB riêng; `password_hash_prefix` bắt đầu bằng bcrypt prefix thay vì plaintext; outbox có `published_at`; Kafka có event OrderCreated; tồn kho và shipment trùng khớp order.

### Bước 10 — Dùng 3 custom SubAgent với Claude Code

Từ project root chạy `claude`. Claude Code nạp `CLAUDE.md` và các agent trong `.claude/agents/`. Gửi nhiệm vụ theo phạm vi nhỏ:

```text
Dùng ba-agent phân tích TC-ORD-03, viết điều kiện đạt và các trường hợp biên. Chưa sửa code.
Dùng dev-agent implement đúng acceptance criteria đã duyệt cho TC-ORD-03, cập nhật test và docs.
Dùng test-agent chạy kiểm tra độc lập cho TC-ORD-03, gồm xác nhận quantity rollback; báo command và bằng chứng.
```

**Kiểm tra khách quan:** ba vai trò có output khác nhau (BA criteria, Dev changes, Test evidence); test-agent báo fail/blocked trung thực; sau mỗi yêu cầu có command và kết quả cụ thể. Không giao cả ba agent quyền thay đổi cùng một file đồng thời.

### Bước 11 — Tự đánh giá 25 test cases và CI

Đối chiếu [test plan](./docs/test/test-plan.md), ghi kết quả thật vào [validation report](./docs/reports/validation-report.md). Sau thay đổi code:

```powershell
npm test
npm run proto:check
docker compose config --quiet
```

**Kiểm tra khách quan:** chỉ đánh dấu test Pass sau khi chạy kiểm tra tương ứng. Bộ project hiện tập trung vào các yêu cầu Microservices trong PROMPT 3; chưa cấu hình GitHub Actions CI cho P3. Local passing không đồng nghĩa GitHub CI đã chạy.

## API, schema và kiểm tra thêm

Xem [API specification](./docs/api/api-specification.md), proto contracts trong `proto/`, data ownership và Outbox trong [architecture](./docs/architecture/architecture.md). Smoke test tự động luồng đăng ký → membership score → product → order → shipment → logout:

```powershell
npm run test:smoke
```

Smoke test cần cả stack healthy và seed admin/shipment credentials hiện diện trong `.env`.

## Dừng stack an toàn

```powershell
docker compose down
```

Lệnh giữ dữ liệu trong named volumes. Không chạy `docker compose down -v` trừ khi chủ động muốn xóa toàn bộ dữ liệu của các service.
