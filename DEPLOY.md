# Deploy demo đồ án - Bookstore Unstructured Data MVP

Mục tiêu: deploy bản demo có **dữ liệu giả y hệt local** gồm `bookstore.db` và thư mục `uploads/`.

## 1. Checklist trước khi deploy

- [x] Dữ liệu trong `bookstore.db` là dữ liệu giả.
- [x] File trong `uploads/` là tài liệu mẫu, không có thông tin thật.
- [x] Không commit `.env`.
- [x] Set `JWT_SECRET` trên nền tảng deploy.
- [x] Không expose thư mục `uploads/` dạng static; app chỉ phục vụ qua API có auth.

## 2. Tài khoản demo

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Quản trị viên | `admin@bookstore.local` | `Admin123!` |
| Quản lý nhà sách | `manager@bookstore.local` | `Manager123!` |
| Nhân viên bán hàng | `sales@bookstore.local` | `Sales123!` |
| Nhân viên kho | `warehouse@bookstore.local` | `Warehouse123!` |
| Kế toán | `accountant@bookstore.local` | `Accountant123!` |
| Nhân viên tài liệu | `documents@bookstore.local` | `Documents123!` |

## 3. Deploy nhanh trên Render

Render phù hợp để demo Node/Express. Lưu ý: nếu dùng free web service không persistent disk, dữ liệu ghi mới sau khi deploy có thể mất khi service restart. Vì bạn muốn deploy y hệt DB hiện tại, cách đơn giản nhất là commit `bookstore.db` và `uploads/` vào repo demo.

### Bước 1: Push source lên GitHub

Repo nên bao gồm:

- `src/`
- `public/`
- `scripts/`
- `package.json`
- `package-lock.json`
- `bookstore.db`
- `uploads/`
- `.env.example`
- `DEPLOY.md`

Không push `.env`.

### Bước 2: Tạo Web Service trên Render

- New → Web Service
- Connect GitHub repo
- Runtime: Node
- Build Command:

```bash
npm ci
```

- Start Command:

```bash
npm start
```

### Bước 3: Environment Variables

Set:

```text
NODE_ENV=production
JWT_SECRET=<chuỗi-random-dài>
```

Tạo secret bằng lệnh local:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Không cần set `PORT`; Render tự cấp `PORT`.

### Bước 4: Health check

Sau khi deploy, kiểm tra:

```text
https://<app>.onrender.com/api/health
```

Kết quả mong muốn:

```json
{"ok":true,"service":"bookstore-unstructured-mvp"}
```

## 4. Deploy trên Railway

Railway cũng chạy được Node/Express.

- New Project → Deploy from GitHub repo
- Variables:

```text
NODE_ENV=production
JWT_SECRET=<chuỗi-random-dài>
```

- Build thường tự nhận `npm install`/`npm ci`.
- Start command: `npm start`.

Nếu Railway yêu cầu config explicit, dùng:

```bash
npm ci
npm start
```

## 5. Lưu ý về SQLite và uploads

App đang dùng:

- DB: `bookstore.db` ở root project.
- Uploads: `uploads/` ở root project.

Với demo môn học, commit hai thứ này là chấp nhận được vì dữ liệu giả. Với production thật thì nên chuyển sang:

- Database managed PostgreSQL.
- File storage S3/R2/Supabase Storage.

## 6. Kiểm thử sau deploy

Set biến `BASE` rồi chạy test từ máy local:

PowerShell:

```powershell
$env:BASE="https://<app>.onrender.com"
npm run rbac:test
npm run scope:test
npm run e2e:roles
```

Hoặc Git Bash/macOS/Linux:

```bash
BASE=https://<app>.onrender.com npm run rbac:test
BASE=https://<app>.onrender.com npm run scope:test
BASE=https://<app>.onrender.com npm run e2e:roles
```

## 7. Nếu muốn reset lại dữ liệu demo

Local:

```bash
node scripts/rbac-seed.js
node scripts/seed-realistic-data.js
node scripts/ensure-sample-uploads.js
```

Sau đó commit lại `bookstore.db` và `uploads/` rồi redeploy.
