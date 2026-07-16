require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const { createWorker } = require('tesseract.js');
const { db, audit: _audit, upsertName, rebuildBookIndex, rebuildDocumentIndex, setDocumentMetadata } = require('./db');
const XLSX = require('xlsx');
const logService = require('./log-service');


// Wrap audit() để vừa ghi DB vừa ghi log file phi cấu trúc
function audit(userId, action, entityType, entityId, details) {
  _audit(userId, action, entityType, entityId, details);
  try {
    const u = userId ? get('SELECT full_name, email FROM users WHERE id=?', [userId]) : null;
    logService.writeLog({
      userName: u?.full_name || null,
      userEmail: u?.email || null,
      action,
      entityType,
      entityId,
      details: details || {},
    });
  } catch {}
}

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const PERMISSION_MAP = {
  'books.view': 'books.manage',
  'books.create': 'books.manage',
  'books.update': 'books.manage',
  'books.delete': 'books.manage',
  'customers.view': 'customers.manage',
  'customers.create': 'customers.manage',
  'customers.update': 'customers.manage',
  'customers.delete': 'customers.manage',
  'orders.view': 'orders.manage',
  'orders.create': 'orders.manage',
  'orders.update': 'orders.manage',
  'orders.cancel': 'orders.manage',
  'inventory.view': 'inventory.manage',
  'inventory.import': 'inventory.manage',
  'inventory.export': 'inventory.manage',
  'inventory.adjust': 'inventory.manage',
  'suppliers.view': 'suppliers.manage',
  'suppliers.create': 'suppliers.manage',
  'suppliers.update': 'suppliers.manage',
  'suppliers.delete': 'suppliers.manage',
  'documents.view': 'documents.manage',
  'documents.view_all': 'documents.manage',
  'documents.create': 'documents.manage',
  'documents.upload': 'documents.manage',
  'documents.update': 'documents.manage',
  'documents.delete': 'documents.manage',
  'reports.view_basic': 'reports.view',
  'reports.view_financial': 'reports.view',
  'users.view': 'users.manage',
  'users.create': 'users.manage',
  'users.update': 'users.manage',
  'users.delete': 'users.manage',
  'roles.manage': 'users.manage',
  'audit_logs.view': 'audit.view',
  'audit.view': 'audit_logs.view',
  'search.use': 'books.manage'
};

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production.');
}
const PORT = Number(process.env.PORT || 4000);
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'bookstore-unstructured-mvp' }));
app.use(express.json({ limit: '2mb' }));
// Không expose upload directory tĩnh; preview/download phải đi qua API có auth.
app.use(express.static(path.join(__dirname, '..', 'public')));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname)}`)
});
const allowed = new Set(['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_, file, cb) => cb(allowed.has(file.mimetype) ? null : new Error('Loại file không được hỗ trợ'), allowed.has(file.mimetype)) });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try { req.user = enrichUser(jwt.verify(token, JWT_SECRET)); next(); } catch { res.status(401).json({ error: 'Token không hợp lệ' }); }
}

// ── Customer Auth Middleware ──
function customerAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  if (!token) {
    const isPublicGet = (req.method === 'GET' && (
      req.path === '/api/customer/books' || 
      /^\/api\/customer\/books\/[^\/]+$/.test(req.path) || 
      /^\/api\/customer\/documents\/[^\/]+\/cover$/.test(req.path)
    ));
    if (isPublicGet) {
      req.user = null;
      return next();
    }
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'customer') return res.status(403).json({ error: 'Token không hợp lệ' });
    req.user = payload; // Set req.user so req.user.id/email/fullName work
    next();
  } catch {
    const isPublicGet = (req.method === 'GET' && (
      req.path === '/api/customer/books' || 
      /^\/api\/customer\/books\/[^\/]+$/.test(req.path) || 
      /^\/api\/customer\/documents\/[^\/]+\/cover$/.test(req.path)
    ));
    if (isPublicGet) {
      req.user = null;
      return next();
    }
    res.status(401).json({ error: 'Token không hợp lệ' });
  }
}

function requireRole(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này.' }); }
function money(v) { return new Intl.NumberFormat('vi-VN').format(v||0) + 'đ'; }
function all(sql, params=[]) { return db.prepare(sql).all(...params); }
function get(sql, params=[]) { return db.prepare(sql).get(...params); }
function userPermissions(userId) {
  const codes = all(`SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id JOIN users u ON u.role_id=rp.role_id WHERE u.id=?`, [userId]).map(p => p.code);
  const expanded = new Set(codes);
  for (const [detailed, coarse] of Object.entries(PERMISSION_MAP)) {
    if (codes.includes(coarse)) {
      expanded.add(detailed);
    }
  }
  return Array.from(expanded);
}
function enrichUser(user) { user.permissions = userPermissions(user.id); return user; }
function requirePermission(...required) {
  return (req, res, next) => {
    const granted = req.user.permissions || userPermissions(req.user.id);
    if (required.some(p => granted.includes(p))) return next();
    return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này.' });
  };
}
function parseTags(value) { return Array.isArray(value) ? value : String(value || '').split(',').map(x=>x.trim()).filter(Boolean); }
function parseMetadata(body) { try { return body.metadata_json ? JSON.parse(body.metadata_json) : {}; } catch { return {}; } }
async function sniffMime(filePath) { const { fileTypeFromFile } = await import('file-type'); return fileTypeFromFile(filePath); }
function sha256(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
async function validateUploadFile(file) {
  const detected = await sniffMime(file.path);
  const ext = path.extname(file.originalname).toLowerCase();
  const textLike = file.mimetype === 'text/plain' && (!detected || ext === '.txt');
  const docxLike = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && detected?.mime === 'application/zip' && ext === '.docx';
  const exact = detected && detected.mime === file.mimetype;
  if (!textLike && !docxLike && !exact) throw new Error('File không khớp định dạng khai báo');
}
function hasPermission(req, permission) { return (req.user.permissions || []).includes(permission); }
function ownOnly(req, allPermission) { return !hasPermission(req, allPermission); }
function denyScoped(res) { return res.status(403).json({ error: 'Bạn không có quyền truy cập dữ liệu này.' }); }
function canManage(req, ...roles) { return roles.includes(req.user.role); }
function csv(res, filename, rows) {
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const escCsv = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = [keys.join(','), ...rows.map(r => keys.map(k => escCsv(r[k])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\ufeff' + body);
}

function excel(res, filename, rows) {
  const wb = XLSX.utils.book_new();
  const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

app.post('/api/auth/login', (req, res) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = get('SELECT u.*, r.name role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.email=? AND u.is_active=1', [body.email]);
  if (!user || !bcrypt.compareSync(body.password, user.password_hash)) return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });
  const permissions = userPermissions(user.id);
  const token = jwt.sign({ id: user.id, email: user.email, fullName: user.full_name, role: user.role, permissions }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role, permissions } });
});
app.get('/api/me', auth, (req, res) => res.json(req.user));

app.get('/api/books', auth, requirePermission('books.view'), (req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(all(`SELECT b.*, a.name author, c.name category, p.name publisher FROM books b
    LEFT JOIN authors a ON a.id=b.author_id LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN publishers p ON p.id=b.publisher_id
    WHERE b.title LIKE ? OR b.code LIKE ? OR b.isbn LIKE ? OR a.name LIKE ? ORDER BY CAST(SUBSTR(b.code, 6) AS INTEGER) DESC`, [q,q,q,q]));
});
app.post('/api/books', auth, requirePermission('books.create'), (req, res) => {
  const s = z.object({ code:z.string().regex(/^BOOK-\d+$/, 'Mã sách phải có định dạng BOOK-xxx (ví dụ: BOOK-001)'), title:z.string().min(1), author:z.string().optional(), category:z.string().optional(), publisher:z.string().optional(), isbn:z.string().optional(), published_year:z.number().optional(), pages:z.number().optional(), language:z.string().optional(), import_price:z.number().default(0), sale_price:z.number().default(0), stock_quantity:z.number().int().default(0), description:z.string().optional(), excerpt:z.string().optional(), tags:z.array(z.string()).default([]) }).parse(req.body);

  const duplicate = s.author
    ? get('SELECT id FROM books WHERE title=? AND author_id=(SELECT id FROM authors WHERE name=?)', [s.title, s.author])
    : get('SELECT id FROM books WHERE title=? AND author_id IS NULL', [s.title]);
  if (duplicate) {
    return res.status(400).json({ error: 'Sách có cùng tên và tác giả này đã tồn tại trong hệ thống.' });
  }

  const bookId = parseInt(s.code.replace('BOOK-', ''), 10);
  if (isNaN(bookId) || bookId <= 0) {
    return res.status(400).json({ error: 'Mã sách không hợp lệ' });
  }
  const code = 'BOOK-' + String(bookId).padStart(3, '0');

  const existingById = get('SELECT id FROM books WHERE id=?', [bookId]);
  if (existingById) {
    return res.status(400).json({ error: `Mã sách ${code} đã tồn tại.` });
  }

  const info = db.prepare(`INSERT INTO books(id,code,title,author_id,category_id,publisher_id,isbn,published_year,pages,language,import_price,sale_price,stock_quantity,description,excerpt,tags)
    VALUES (@id,@code,@title,@author_id,@category_id,@publisher_id,@isbn,@published_year,@pages,@language,@import_price,@sale_price,@stock_quantity,@description,@excerpt,@tags)`).run({
      id: bookId,
      code,
      title: s.title,
      author_id: s.author ? upsertName('authors', s.author) : null,
      category_id: s.category ? upsertName('categories', s.category) : null,
      publisher_id: s.publisher ? upsertName('publishers', s.publisher) : null,
      isbn: s.isbn ?? null,
      published_year: s.published_year ?? null,
      pages: s.pages ?? null,
      language: s.language ?? 'vi',
      import_price: s.import_price,
      sale_price: s.sale_price,
      stock_quantity: s.stock_quantity,
      description: s.description ?? null,
      excerpt: s.excerpt ?? null,
      tags: JSON.stringify(s.tags)
    });
  rebuildBookIndex(bookId); audit(req.user.id,'create','book',bookId,s); res.status(201).json(get('SELECT * FROM books WHERE id=?',[bookId]));
});
app.get('/api/books/:id', auth, requirePermission('books.view'), (req, res) => {
  const book = get(`SELECT b.*, a.name author, c.name category, p.name publisher FROM books b LEFT JOIN authors a ON a.id=b.author_id LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN publishers p ON p.id=b.publisher_id WHERE b.id=?`, [req.params.id]);
  if (!book) return res.status(404).json({ error:'Không tìm thấy sách' });
  book.documents = all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?', ['book', book.id]);
  res.json(book);
});
app.put('/api/books/:id', auth, requirePermission('books.update'), (req, res) => {
  const old = get('SELECT * FROM books WHERE id=?',[req.params.id]); if (!old) return res.status(404).json({error:'Không tìm thấy sách'});
  const s = { ...old, ...req.body };
  
  const author_id = req.body.author !== undefined
    ? (req.body.author ? upsertName('authors', req.body.author) : null)
    : old.author_id;
  const duplicate = author_id
    ? get('SELECT id FROM books WHERE title=? AND author_id=? AND id <> ?', [s.title, author_id, req.params.id])
    : get('SELECT id FROM books WHERE title=? AND author_id IS NULL AND id <> ?', [s.title, req.params.id]);
  if (duplicate) {
    return res.status(400).json({ error: 'Sách có cùng tên và tác giả này đã tồn tại trong hệ thống.' });
  }

  if (req.body.code !== undefined) {
    const bookId = parseInt(req.body.code.replace('BOOK-', ''), 10);
    if (isNaN(bookId) || bookId <= 0) {
      return res.status(400).json({ error: 'Mã sách không hợp lệ' });
    }
    const code = 'BOOK-' + String(bookId).padStart(3, '0');
    if (bookId !== old.id) {
      return res.status(400).json({ error: 'Không thể thay đổi Mã sách sang ID khác.' });
    }
    s.code = code;
  }

  db.prepare(`UPDATE books SET code=?,title=?,author_id=?,category_id=?,publisher_id=?,isbn=?,published_year=?,pages=?,language=?,import_price=?,sale_price=?,stock_quantity=?,description=?,excerpt=?,tags=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(s.code,s.title,author_id,s.category?upsertName('categories',s.category):old.category_id,s.publisher?upsertName('publishers',s.publisher):old.publisher_id,s.isbn,s.published_year,s.pages,s.language,s.import_price,s.sale_price,s.stock_quantity,s.description,s.excerpt,JSON.stringify(s.tags||[]),req.params.id);
  rebuildBookIndex(req.params.id); audit(req.user.id,'update','book',req.params.id,req.body); res.json(get('SELECT * FROM books WHERE id=?',[req.params.id]));
});
app.delete('/api/books/:id', auth, requirePermission('books.delete'), (req, res) => { db.prepare('DELETE FROM search_index WHERE entity_type=? AND entity_id=?').run('book', req.params.id); db.prepare('DELETE FROM books WHERE id=?').run(req.params.id); audit(req.user.id,'delete','book',req.params.id); res.json({ ok:true }); });
app.get('/api/categories', (req, res) => res.json(all('SELECT * FROM categories ORDER BY name')));

app.get('/api/customers', auth, requirePermission('customers.view'), (req,res)=>{ const q=`%${req.query.q||''}%`; if(ownOnly(req,'customers.view_all')) return res.json(all('SELECT * FROM customers WHERE created_by=? AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ?) ORDER BY id DESC',[req.user.id,q,q,q,q])); res.json(all('SELECT * FROM customers WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ? ORDER BY id DESC',[q,q,q,q])); });
app.post('/api/customers', auth, requirePermission('customers.create'), (req,res)=>{ const s=z.object({full_name:z.string(),phone:z.string().optional(),email:z.string().optional(),type:z.string().default('retail'),notes:z.string().optional()}).parse(req.body); const r=db.prepare('INSERT INTO customers(full_name,phone,email,type,notes,created_by) VALUES (@full_name,@phone,@email,@type,@notes,@created_by)').run({ full_name: s.full_name, phone: s.phone ?? null, email: s.email ?? null, type: s.type, notes: s.notes ?? null, created_by: req.user.id }); audit(req.user.id,'create','customer',r.lastInsertRowid,s); res.status(201).json(get('SELECT * FROM customers WHERE id=?',[r.lastInsertRowid])); });
app.get('/api/customers/segments', auth, requirePermission('customers.view'), (req, res) => {
  try {
    const segmentation = require('./customer-segmentation');
    const segments = segmentation.segmentCustomers(db);
    
    const segmentNames = ['VIP', 'Khách thân thiết', 'Khách vãng lai', 'Học sinh / Sinh viên'];
    const summary = {};
    segmentNames.forEach(seg => {
      summary[seg] = { count: 0, total_spent: 0, total_orders: 0, customers: [] };
    });
    
    segments.forEach(s => {
      const seg = s.segment;
      if (summary[seg]) {
        summary[seg].count++;
        summary[seg].total_spent += s.total_spent;
        summary[seg].total_orders += s.order_count;
        summary[seg].customers.push({ id: s.id, full_name: s.full_name, total_spent: s.total_spent, order_count: s.order_count });
      }
    });
    
    res.json({ segments, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/customers/:id', auth, requirePermission('customers.view'), (req,res)=>{ const c=get('SELECT * FROM customers WHERE id=?',[req.params.id]); if(!c) return res.status(404).json({error:'Không tìm thấy khách hàng'}); if(ownOnly(req,'customers.view_all') && c.created_by !== req.user.id) return denyScoped(res); c.orders=all('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC',[c.id]); c.reviews=all('SELECT r.*, b.title book_title FROM reviews r LEFT JOIN books b ON b.id=r.book_id WHERE r.customer_id=? ORDER BY r.created_at DESC',[c.id]); c.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['customer',c.id]); res.json(c); });
app.put('/api/customers/:id', auth, requirePermission('customers.update'), (req,res)=>{ const old=get('SELECT * FROM customers WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy khách hàng'}); const s={...old,...req.body}; db.prepare('UPDATE customers SET full_name=?,phone=?,email=?,type=?,notes=? WHERE id=?').run(s.full_name,s.phone,s.email,s.type,s.notes,req.params.id); audit(req.user.id,'update','customer',req.params.id,req.body); res.json(get('SELECT * FROM customers WHERE id=?',[req.params.id])); });
app.delete('/api/customers/:id', auth, requirePermission('customers.delete'), (req,res)=>{ db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id); audit(req.user.id,'delete','customer',req.params.id); res.json({ok:true}); });

app.get('/api/suppliers', auth, requirePermission('suppliers.view'), (req,res)=>{ const q=`%${req.query.q||''}%`; res.json(all('SELECT * FROM suppliers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ? ORDER BY id DESC',[q,q,q,q])); });
app.post('/api/suppliers', auth, requirePermission('suppliers.create'), (req,res)=>{ const s=req.body; const r=db.prepare('INSERT INTO suppliers(name,contact_name,phone,email,address,notes,rating) VALUES (@name,@contact_name,@phone,@email,@address,@notes,@rating)').run({ name: s.name, contact_name: s.contact_name ?? null, phone: s.phone ?? null, email: s.email ?? null, address: s.address ?? null, notes: s.notes ?? null, rating: s.rating ?? 3 }); audit(req.user.id,'create','supplier',r.lastInsertRowid,s); res.status(201).json(get('SELECT * FROM suppliers WHERE id=?',[r.lastInsertRowid])); });
app.get('/api/suppliers/:id', auth, requirePermission('suppliers.view'), (req,res)=>{ const s=get('SELECT * FROM suppliers WHERE id=?',[req.params.id]); if(!s) return res.status(404).json({error:'Không tìm thấy nhà cung cấp'}); s.inventory=all('SELECT it.*, b.title book_title FROM inventory_transactions it JOIN books b ON b.id=it.book_id WHERE it.supplier_id=? ORDER BY it.created_at DESC',[s.id]); s.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['supplier',s.id]); res.json(s); });
app.put('/api/suppliers/:id', auth, requirePermission('suppliers.update'), (req,res)=>{ const old=get('SELECT * FROM suppliers WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy nhà cung cấp'}); const s={...old,...req.body}; db.prepare('UPDATE suppliers SET name=?,contact_name=?,phone=?,email=?,address=?,notes=?,rating=? WHERE id=?').run(s.name,s.contact_name,s.phone,s.email,s.address,s.notes,s.rating,req.params.id); audit(req.user.id,'update','supplier',req.params.id,req.body); res.json(get('SELECT * FROM suppliers WHERE id=?',[req.params.id])); });
app.delete('/api/suppliers/:id', auth, requirePermission('suppliers.delete'), (req,res)=>{ db.prepare('DELETE FROM suppliers WHERE id=?').run(req.params.id); audit(req.user.id,'delete','supplier',req.params.id); res.json({ok:true}); });

app.get('/api/orders', auth, requirePermission('orders.view'), (req,res)=>{ const where=ownOnly(req,'orders.view_all')?'WHERE o.created_by=?':''; const params=where?[req.user.id]:[]; res.json(all(`SELECT o.*, c.full_name customer_name, u.full_name created_by_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.created_by ${where} ORDER BY o.created_at DESC`,params)); });
app.get('/api/orders/:id', auth, requirePermission('orders.view'), (req,res)=>{ if(!/^\d+$/.test(String(req.params.id))) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); const o=get(`SELECT o.*, c.full_name customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`,[req.params.id]); if(!o) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && o.created_by !== req.user.id) return denyScoped(res); o.items=all('SELECT oi.*, b.title book_title, b.code book_code FROM order_items oi JOIN books b ON b.id=oi.book_id WHERE oi.order_id=?',[o.id]); o.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['order',o.id]); res.json(o); });
app.post('/api/orders', auth, requirePermission('orders.create'), (req,res)=>{
  const s=z.object({customer_id:z.number().optional(), payment_method:z.string().default('cash'), discount:z.number().default(0), tax:z.number().default(0), notes:z.string().optional(), items:z.array(z.object({book_id:z.number(),quantity:z.number().int().positive()})).min(1)}).parse(req.body);
  const tx=db.transaction(()=>{ let subtotal=0; const priced=s.items.map(i=>{ const b=get('SELECT id,title,sale_price,stock_quantity FROM books WHERE id=?',[i.book_id]); if(!b) throw new Error('Sách không tồn tại'); if(b.stock_quantity<i.quantity) throw new Error(`Không đủ tồn kho: ${b.title}`); const total=b.sale_price*i.quantity; subtotal+=total; return {...i, unit_price:b.sale_price,total}; }); const total=subtotal-s.discount+s.tax; const code=`ORD-${Date.now()}`; const r=db.prepare('INSERT INTO orders(order_code,customer_id,payment_method,subtotal,discount,tax,total,notes,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(code,s.customer_id||null,s.payment_method,subtotal,s.discount,s.tax,total,s.notes||null,'paid',req.user.id); priced.forEach(i=>{ db.prepare('INSERT INTO order_items(order_id,book_id,quantity,unit_price,total) VALUES (?,?,?,?,?)').run(r.lastInsertRowid,i.book_id,i.quantity,i.unit_price,i.total); db.prepare('UPDATE books SET stock_quantity=stock_quantity-?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(i.quantity,i.book_id); db.prepare('INSERT INTO inventory_transactions(book_id,type,quantity,note,created_by) VALUES (?,?,?,?,?)').run(i.book_id,'sale',-i.quantity,code,req.user.id); rebuildBookIndex(i.book_id); }); audit(req.user.id,'create','order',r.lastInsertRowid,s); return get('SELECT * FROM orders WHERE id=?',[r.lastInsertRowid]); });
  try { res.status(201).json(tx()); } catch(e) { res.status(400).json({error:e.message}); }
});
app.put('/api/orders/:id/status', auth, requirePermission('orders.update'), (req,res)=>{ const s=z.object({status:z.enum(['new','paid','shipping','completed','cancelled']), notes:z.string().optional()}).parse(req.body); const old=get('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && old.created_by !== req.user.id) return denyScoped(res); db.prepare('UPDATE orders SET status=?, notes=COALESCE(?, notes) WHERE id=?').run(s.status,s.notes,req.params.id); audit(req.user.id,'update_status','order',req.params.id,s); res.json(get('SELECT * FROM orders WHERE id=?',[req.params.id])); });
app.post('/api/orders/:id/cancel', auth, requirePermission('orders.cancel'), (req,res)=>{ const old=get('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && old.created_by !== req.user.id) return denyScoped(res); if(old.status==='cancelled') return res.status(400).json({error:'Đơn hàng đã hủy'}); const reason=req.body?.reason||'Hủy đơn và hoàn tồn kho'; const tx=db.transaction(()=>{ const items=all('SELECT * FROM order_items WHERE order_id=?',[old.id]); items.forEach(i=>{ db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(i.quantity,i.book_id); db.prepare('INSERT INTO inventory_transactions(book_id,type,quantity,note,created_by) VALUES (?,?,?,?,?)').run(i.book_id,'return',i.quantity,`${old.order_code} - ${reason}`,req.user.id); rebuildBookIndex(i.book_id); }); db.prepare('UPDATE orders SET status=?, notes=COALESCE(notes,\'\') || ? WHERE id=?').run('cancelled',`\n[CANCEL] ${reason}`,old.id); audit(req.user.id,'cancel','order',old.id,{reason, restoredItems:items.length}); return get('SELECT * FROM orders WHERE id=?',[old.id]); }); try{res.json(tx())}catch(e){res.status(400).json({error:e.message})} });
app.delete('/api/orders/:id', auth, requirePermission('orders.cancel'), (req,res)=>{ const old=get('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && old.created_by !== req.user.id) return denyScoped(res); db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id); audit(req.user.id,'delete','order',req.params.id); res.json({ok:true}); });

app.get('/api/inventory', auth, requirePermission('inventory.view'), (req,res)=>res.json(all(`SELECT b.id book_id,b.code,b.title,b.stock_quantity,b.import_price,b.sale_price,c.name category FROM books b LEFT JOIN categories c ON c.id=b.category_id ORDER BY b.stock_quantity ASC`)));
app.get('/api/inventory/slips', auth, requirePermission('inventory.view'), (req,res)=>res.json(all(`SELECT sl.*, s.name supplier_name, u.full_name created_by_name, COUNT(it.id) item_count, COALESCE(SUM(ABS(it.quantity) * it.unit_cost),0) total_cost FROM inventory_slips sl LEFT JOIN suppliers s ON s.id=sl.supplier_id LEFT JOIN users u ON u.id=sl.created_by LEFT JOIN inventory_transactions it ON it.slip_id=sl.id GROUP BY sl.id ORDER BY sl.created_at DESC LIMIT 200`)));
app.get('/api/inventory/slips/:id', auth, requirePermission('inventory.view'), (req,res)=>{ if(!/^\d+$/.test(String(req.params.id))) return res.status(404).json({error:'Không tìm thấy phiếu kho'}); const sl=get(`SELECT sl.*, s.name supplier_name, u.full_name created_by_name FROM inventory_slips sl LEFT JOIN suppliers s ON s.id=sl.supplier_id LEFT JOIN users u ON u.id=sl.created_by WHERE sl.id=?`,[req.params.id]); if(!sl) return res.status(404).json({error:'Không tìm thấy phiếu kho'}); sl.items=all(`SELECT it.*, b.code book_code, b.title book_title FROM inventory_transactions it JOIN books b ON b.id=it.book_id WHERE it.slip_id=?`,[sl.id]); sl.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['inventory_slip',sl.id]); res.json(sl); });
app.post('/api/inventory/slips', auth, requirePermission('inventory.import','inventory.export','inventory.adjust'), (req,res)=>{ const s=z.object({type:z.enum(['in','out','adjust']),supplier_id:z.number().optional(),note:z.string().optional(),items:z.array(z.object({book_id:z.number(),quantity:z.number().int(),unit_cost:z.number().default(0)})).min(1)}).parse(req.body); const tx=db.transaction(()=>{ const code=`SLIP-${s.type.toUpperCase()}-${Date.now()}`; const sr=db.prepare('INSERT INTO inventory_slips(slip_code,type,supplier_id,note,created_by) VALUES (?,?,?,?,?)').run(code,s.type,s.supplier_id||null,s.note||null,req.user.id); s.items.forEach(item=>{ const delta=s.type==='in'?Math.abs(item.quantity):s.type==='out'?-Math.abs(item.quantity):item.quantity; const b=get('SELECT id,title,stock_quantity FROM books WHERE id=?',[item.book_id]); if(!b) throw new Error('Sách không tồn tại'); if(s.type==='out' && b.stock_quantity < Math.abs(item.quantity)) throw new Error(`Không đủ tồn kho: ${b.title}`); db.prepare('INSERT INTO inventory_transactions(slip_id,book_id,supplier_id,type,quantity,unit_cost,note,created_by) VALUES (?,?,?,?,?,?,?,?)').run(sr.lastInsertRowid,item.book_id,s.supplier_id||null,s.type,delta,item.unit_cost,s.note||code,req.user.id); db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, import_price=CASE WHEN ? > 0 THEN ? ELSE import_price END, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(delta,item.unit_cost,item.unit_cost,item.book_id); rebuildBookIndex(item.book_id); }); audit(req.user.id,'create','inventory_slip',sr.lastInsertRowid,s); return get('SELECT * FROM inventory_slips WHERE id=?',[sr.lastInsertRowid]); }); try{res.status(201).json(tx())}catch(e){res.status(400).json({error:e.message})} });
app.post('/api/inventory/slips/:id/cancel', auth, requirePermission('inventory.adjust'), (req,res)=>{ const sl=get('SELECT * FROM inventory_slips WHERE id=?',[req.params.id]); if(!sl) return res.status(404).json({error:'Không tìm thấy phiếu kho'}); if(sl.status==='cancelled') return res.status(400).json({error:'Phiếu kho đã hủy'}); const reason=req.body?.reason||'Hủy phiếu kho và đảo tồn'; const tx=db.transaction(()=>{ const items=all('SELECT * FROM inventory_transactions WHERE slip_id=?',[sl.id]); items.forEach(i=>{ const reverse=-i.quantity; const b=get('SELECT id,title,stock_quantity FROM books WHERE id=?',[i.book_id]); if(!b) throw new Error('Sách không tồn tại'); if(reverse<0 && b.stock_quantity < Math.abs(reverse)) throw new Error(`Không đủ tồn kho để hủy phiếu: ${b.title}`); db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(reverse,i.book_id); db.prepare('INSERT INTO inventory_transactions(book_id,supplier_id,type,quantity,unit_cost,note,created_by) VALUES (?,?,?,?,?,?,?)').run(i.book_id,i.supplier_id,'reverse',reverse,i.unit_cost,`${sl.slip_code} - ${reason}`,req.user.id); rebuildBookIndex(i.book_id); }); db.prepare("UPDATE inventory_slips SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?").run(req.user.id,sl.id); audit(req.user.id,'cancel','inventory_slip',sl.id,{reason,reversedItems:items.length}); return get('SELECT * FROM inventory_slips WHERE id=?',[sl.id]); }); try{res.json(tx())}catch(e){res.status(400).json({error:e.message})} });
app.get('/api/inventory/transactions', auth, requirePermission('inventory.view'), (req,res)=>res.json(all(`SELECT it.*, sl.slip_code, b.title book_title, s.name supplier_name, u.full_name created_by_name FROM inventory_transactions it LEFT JOIN inventory_slips sl ON sl.id=it.slip_id LEFT JOIN books b ON b.id=it.book_id LEFT JOIN suppliers s ON s.id=it.supplier_id LEFT JOIN users u ON u.id=it.created_by ORDER BY it.created_at DESC LIMIT 200`)));
app.get('/api/inventory/books/:bookId/transactions', auth, requirePermission('inventory.view'), (req,res)=>res.json(all(`SELECT it.*, sl.slip_code, s.name supplier_name, u.full_name created_by_name FROM inventory_transactions it LEFT JOIN inventory_slips sl ON sl.id=it.slip_id LEFT JOIN suppliers s ON s.id=it.supplier_id LEFT JOIN users u ON u.id=it.created_by WHERE it.book_id=? ORDER BY it.created_at DESC`,[req.params.bookId])));
app.post('/api/inventory/transactions', auth, requirePermission('inventory.import','inventory.export','inventory.adjust'), (req,res)=>{ const s=z.object({book_id:z.number(),supplier_id:z.number().optional(),type:z.enum(['in','out','adjust']),quantity:z.number().int(),unit_cost:z.number().default(0),note:z.string().optional()}).parse(req.body); const delta=s.type==='in'?Math.abs(s.quantity):s.type==='out'?-Math.abs(s.quantity):s.quantity; const r=db.transaction(()=>{ const rr=db.prepare('INSERT INTO inventory_transactions(book_id,supplier_id,type,quantity,unit_cost,note,created_by) VALUES (?,?,?,?,?,?,?)').run(s.book_id,s.supplier_id||null,s.type,delta,s.unit_cost,s.note||null,req.user.id); db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, import_price=CASE WHEN ? > 0 THEN ? ELSE import_price END, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(delta,s.unit_cost,s.unit_cost,s.book_id); rebuildBookIndex(s.book_id); audit(req.user.id,'create','inventory_transaction',rr.lastInsertRowid,s); return rr.lastInsertRowid; })(); res.status(201).json(get('SELECT * FROM inventory_transactions WHERE id=?',[r])); });

function classifyDocument(text) {
  if (!text || typeof text !== 'string') return 'internal';
  const cleanText = text.toLowerCase();
  
  const rules = {
    invoice: [/hóa đơn/g, /hoá đơn/g, /invoice/g, /tổng tiền/g, /đơn giá/g, /thành tiền/g, /vat/g, /thuế/g, /nxb/g, /nhà xuất bản/g, /thanh toán/g, /số tiền/g],
    contract: [/hợp đồng/g, /contract/g, /thỏa thuận/g, /thoả thuận/g, /điều khoản/g, /bên a/g, /bên b/g, /đại diện/g, /ký kết/g, /ủy quyền/g, /biên bản/g],
    inventory_note: [/nhập kho/g, /xuất kho/g, /tồn kho/g, /kiểm kho/g, /phiếu kho/g, /thẻ kho/g, /kho hàng/g, /số lượng nhập/g, /kệ hàng/g],
    customer_feedback: [/đánh giá/g, /phản hồi/g, /nhận xét/g, /chất lượng/g, /dịch vụ/g, /góp ý/g, /sách rách/g, /giao hàng/g, /thái độ/g],
    book_description: [/tác giả/g, /tóm tắt/g, /mục lục/g, /chương/g, /giới thiệu/g, /cốt truyện/g, /nhân vật/g, /thể loại/g]
  };

  let bestType = 'internal';
  let maxMatches = 0;

  for (const [type, regexes] of Object.entries(rules)) {
    let matchesCount = 0;
    regexes.forEach(regex => {
      const matches = cleanText.match(regex);
      if (matches) {
        matchesCount += matches.length;
      }
    });
    if (matchesCount > maxMatches) {
      maxMatches = matchesCount;
      bestType = type;
    }
  }

  return bestType;
}

async function ocrImage(file) {
  const worker = await createWorker('vie+eng');
  try { const result = await worker.recognize(file.path); return (result.data.text || '').slice(0,200000); }
  finally { await worker.terminate(); }
}
async function extractText(file) {
  try {
    if (file.mimetype==='text/plain') return {text:fs.readFileSync(file.path,'utf8').slice(0,200000), status:'done'};
    if (file.mimetype==='application/pdf') {
      const parser = new PDFParse({ data: fs.readFileSync(file.path) });
      const result = await parser.getText();
      await parser.destroy();
      return {text: (result.text || '').slice(0,200000), status:'done'};
    }
    if (file.mimetype.includes('wordprocessingml')) return {text:(await mammoth.extractRawText({path:file.path})).value.slice(0,200000), status:'done'};
    if (file.mimetype.startsWith('image/')) return {text:await ocrImage(file), status:'done'};
    return {text:'', status:'not_required'};
  } catch(e) {
    return {text:'', status:'failed', error:e.message};
  }
}
app.get('/api/documents', auth, requirePermission('documents.view'), (req,res)=>{ const q=`%${req.query.q||''}%`; const entityType=req.query.entity_type; const entityId=req.query.entity_id; const own=ownOnly(req,'documents.view_all'); if(entityType && entityId) return res.json(all(`SELECT * FROM documents WHERE entity_type=? AND entity_id=? ${own?'AND uploaded_by=?':''} ORDER BY created_at DESC`, own?[entityType,entityId,req.user.id]:[entityType,entityId])); if(own) return res.json(all('SELECT * FROM documents WHERE uploaded_by=? AND (original_name LIKE ? OR title LIKE ? OR notes LIKE ? OR extracted_text LIKE ?) ORDER BY created_at DESC',[req.user.id,q,q,q,q])); res.json(all('SELECT * FROM documents WHERE original_name LIKE ? OR title LIKE ? OR notes LIKE ? OR extracted_text LIKE ? ORDER BY created_at DESC',[q,q,q,q])); });
app.post('/api/documents', auth, requirePermission('documents.upload'), upload.single('file'), async (req,res)=>{
  if(!req.file) return res.status(400).json({error:'Thiếu file'});
  try{
    await validateUploadFile(req.file);
    const decodedOriginalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const checksum=sha256(req.file.path);
    const duplicate=get('SELECT id, original_name FROM documents WHERE checksum=? LIMIT 1',[checksum]);
    const extracted=await extractText(req.file);
    let docType = req.body.doc_type || 'internal';
    let isAutoClassified = false;
    if (docType === 'auto') {
      docType = classifyDocument(extracted.text);
      isAutoClassified = true;
    }
    const meta={
      doc_type:docType,
      entity_type:req.body.entity_type||null,
      entity_id:req.body.entity_id?Number(req.body.entity_id):null,
      title:req.body.title||decodedOriginalName,
      notes:req.body.notes||'',
      tags:JSON.stringify(parseTags(req.body.tags)),
      is_important:req.body.is_important==='true'?1:0
    };
    const r=db.prepare(`INSERT INTO documents(original_name,stored_name,mime_type,size,checksum,doc_type,entity_type,entity_id,title,notes,tags,is_important,extracted_text,ocr_status,processing_error,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(decodedOriginalName,req.file.filename,req.file.mimetype,req.file.size,checksum,meta.doc_type,meta.entity_type,meta.entity_id,meta.title,meta.notes,meta.tags,meta.is_important,extracted.text,extracted.status,extracted.error||null,req.user.id);
    const extraMeta = {
      ...parseMetadata(req.body),
      originalExtension:path.extname(decodedOriginalName),
      storage:'local',
      checksum,
      duplicateOf:duplicate?.id||null
    };
    if (isAutoClassified) {
      extraMeta.autoClassified = 'true';
    }
    setDocumentMetadata(r.lastInsertRowid, extraMeta);
    rebuildDocumentIndex(r.lastInsertRowid);
    audit(req.user.id,'upload','document',r.lastInsertRowid,{...meta,checksum,duplicateOf:duplicate?.id||null});
    res.status(201).json(get('SELECT * FROM documents WHERE id=?',[r.lastInsertRowid]));
  }catch(e){
    try{fs.unlinkSync(req.file.path)}catch{}
    res.status(400).json({error:e.message});
  }
});
app.get('/api/documents/:id', auth, requirePermission('documents.view'), (req,res)=>{ const d=get('SELECT * FROM documents WHERE id=?',[req.params.id]); if(!d) return res.status(404).json({error:'Không tìm thấy tài liệu'}); if(ownOnly(req,'documents.view_all') && d.uploaded_by !== req.user.id) return denyScoped(res); d.metadata=all('SELECT meta_key, meta_value FROM document_metadata WHERE document_id=? ORDER BY meta_key',[d.id]); d.preview_url=`/api/documents/${d.id}/preview`; d.text_url=`/api/documents/${d.id}/text`; d.download_url=`/api/documents/${d.id}/download`; res.json(d); });
app.get('/api/documents/:id/text', auth, requirePermission('documents.view'), (req,res)=>{ const d=get('SELECT id, original_name, mime_type, extracted_text, processing_error, uploaded_by FROM documents WHERE id=?',[req.params.id]); if(!d) return res.status(404).json({error:'Không tìm thấy tài liệu'}); if(ownOnly(req,'documents.view_all') && d.uploaded_by !== req.user.id) return denyScoped(res); res.type('text/plain; charset=utf-8').send(d.extracted_text || d.processing_error || ''); });
app.put('/api/documents/:id', auth, requirePermission('documents.update'), (req,res)=>{ const old=get('SELECT * FROM documents WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy tài liệu'}); if(ownOnly(req,'documents.view_all') && old.uploaded_by !== req.user.id) return denyScoped(res); const s={...old,...req.body}; db.prepare('UPDATE documents SET doc_type=?, entity_type=?, entity_id=?, title=?, notes=?, tags=?, is_important=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(s.doc_type,s.entity_type||null,s.entity_id||null,s.title,s.notes,JSON.stringify(parseTags(s.tags)),s.is_important?1:0,req.params.id); if(req.body.metadata) setDocumentMetadata(req.params.id, req.body.metadata); rebuildDocumentIndex(req.params.id); audit(req.user.id,'update','document',req.params.id,req.body); res.json(get('SELECT * FROM documents WHERE id=?',[req.params.id])); });
app.delete('/api/documents/:id', auth, requirePermission('documents.delete'), (req,res)=>{ const d=get('SELECT * FROM documents WHERE id=?',[req.params.id]); if(!d) return res.status(404).json({error:'Không tìm thấy tài liệu'}); if(ownOnly(req,'documents.view_all') && d.uploaded_by !== req.user.id) return denyScoped(res); db.prepare('DELETE FROM search_index WHERE entity_type=? AND entity_id=?').run('document', req.params.id); db.prepare('DELETE FROM documents WHERE id=?').run(req.params.id); try{fs.unlinkSync(path.join(uploadDir,d.stored_name));}catch{} audit(req.user.id,'delete','document',req.params.id); res.json({ok:true}); });
app.post('/api/documents/:id/reprocess', auth, requirePermission('documents.update'), async (req,res)=>{
  const d=get('SELECT * FROM documents WHERE id=?',[req.params.id]);
  if(!d) return res.status(404).json({error:'Không tìm thấy tài liệu'});
  if(ownOnly(req,'documents.view_all') && d.uploaded_by !== req.user.id) return denyScoped(res);
  
  const file={path:path.join(uploadDir,d.stored_name), mimetype:d.mime_type};
  const extracted=await extractText(file);
  
  // Re-classify if originally auto-classified
  const hasMeta = get('SELECT id FROM document_metadata WHERE document_id=? AND meta_key=? AND meta_value=?', [d.id, 'autoClassified', 'true']);
  let docType = d.doc_type;
  if (hasMeta) {
    docType = classifyDocument(extracted.text);
  }
  
  db.prepare('UPDATE documents SET extracted_text=?, ocr_status=?, doc_type=?, processing_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(extracted.text,extracted.status,docType,extracted.error||null,d.id);
  rebuildDocumentIndex(d.id);
  audit(req.user.id,'reprocess','document',d.id);
  res.json(get('SELECT * FROM documents WHERE id=?',[d.id]));
});
app.get('/api/documents/:id/preview', auth, requirePermission('documents.view'), (req,res)=>{
  const d=get('SELECT * FROM documents WHERE id=?',[req.params.id]);
  if(!d) return res.status(404).json({error:'Không tìm thấy tài liệu'});
  if(ownOnly(req,'documents.view_all') && d.uploaded_by !== req.user.id) return denyScoped(res);
  
  res.setHeader('Content-Type', d.mime_type);
  // Omit Content-Disposition for PDF to bypass IDM interception
  if (d.mime_type !== 'application/pdf') {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.original_name)}"`);
  }
  fs.createReadStream(path.join(uploadDir,d.stored_name)).pipe(res);
});
app.get('/api/documents/:id/download', auth, requirePermission('documents.view'), (req,res)=>{
  const d=get('SELECT * FROM documents WHERE id=?',[req.params.id]);
  if(!d) return res.status(404).json({error:'Không tìm thấy tài liệu'});
  if(ownOnly(req,'documents.view_all') && d.uploaded_by !== req.user.id) return denyScoped(res);
  
  const filePath = path.join(uploadDir, d.stored_name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File vật lý không tồn tại trên server' });
  }
  
  res.setHeader('Content-Type', d.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.original_name)}`);
  fs.createReadStream(filePath).pipe(res);
});

app.get('/api/search', auth, requirePermission('search.use'), (req,res)=>{
  const q=(req.query.q||'').trim();
  if(!q) return res.json([]);
  const cleanQ = q.replace(/[^\w\s\dàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, ' ').trim();
  if(!cleanQ) return res.json([]);
  try {
    res.json(all(`SELECT entity_type, entity_id, title, snippet(search_index, 3, '<mark>', '</mark>', '...', 12) snippet, bm25(search_index) rank FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 50`, [cleanQ]));
  } catch (err) {
    res.json([]);
  }
});
app.get('/api/dashboard', auth, requirePermission('reports.view_basic'), (req,res)=>{
  const totals = {
    books: get('SELECT COUNT(*) c FROM books').c,
    customers: get('SELECT COUNT(*) c FROM customers').c,
    orders: get('SELECT COUNT(*) c FROM orders').c,
    documents: get('SELECT COUNT(*) c FROM documents').c,
    revenue: get("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status <> 'cancelled'").v,
    lowStock: get('SELECT COUNT(*) c FROM books WHERE stock_quantity <= 5').c
  };
  const lowStock = all('SELECT code,title,stock_quantity FROM books WHERE stock_quantity <= 5 ORDER BY stock_quantity ASC LIMIT 10');
  const topBooks = all(`SELECT b.title, SUM(oi.quantity) qty, SUM(oi.total) revenue FROM order_items oi JOIN books b ON b.id=oi.book_id JOIN orders o ON o.id=oi.order_id WHERE o.status <> 'cancelled' GROUP BY b.id ORDER BY qty DESC, revenue DESC LIMIT 10`);
  const documentTypes = all('SELECT doc_type, COUNT(*) count FROM documents GROUP BY doc_type');
  
  // Unstructured stats
  const unstructuredStats = {
    totalDocs: totals.documents,
    totalSize: get('SELECT COALESCE(SUM(size), 0) s FROM documents').s,
    mimeDistribution: all('SELECT mime_type, COUNT(*) count FROM documents GROUP BY mime_type'),
    ocrStatusDistribution: all('SELECT ocr_status, COUNT(*) count FROM documents GROUP BY ocr_status'),
    docTypeDistribution: documentTypes
  };

  res.json({
    totals,
    lowStock,
    topBooks,
    documentTypes,
    unstructuredStats
  });
});
app.get('/api/reports/export/:type', auth, requirePermission('reports.view_basic','reports.view_financial'), (req,res)=>{
  const type=req.params.type;
  const format=req.query.format || 'csv';
  const map={
    books:{file:'books', sql:`SELECT b.id,b.code,b.title,a.name author,c.name category,p.name publisher,b.isbn,b.sale_price,b.stock_quantity,b.created_at FROM books b LEFT JOIN authors a ON a.id=b.author_id LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN publishers p ON p.id=b.publisher_id ORDER BY b.id`},
    customers:{file:'customers', sql:'SELECT * FROM customers ORDER BY id'},
    orders:{file:'orders', sql:`SELECT o.*, c.full_name customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id ORDER BY o.created_at DESC`},
    inventory:{file:'inventory', sql:`SELECT b.id book_id,b.code,b.title,b.stock_quantity,b.import_price,b.sale_price,c.name category FROM books b LEFT JOIN categories c ON c.id=b.category_id ORDER BY b.title`},
    documents:{file:'documents', sql:'SELECT id,original_name,mime_type,size,doc_type,entity_type,entity_id,title,ocr_status,created_at FROM documents ORDER BY created_at DESC'},
    slips:{file:'inventory_slips', sql:`SELECT sl.*, s.name supplier_name, u.full_name created_by_name FROM inventory_slips sl LEFT JOIN suppliers s ON s.id=sl.supplier_id LEFT JOIN users u ON u.id=sl.created_by ORDER BY sl.created_at DESC`}
  };
  if(!map[type]) return res.status(404).json({error:'Loại report không hỗ trợ'});
  const data = all(map[type].sql);
  if(format === 'excel' || format === 'xlsx') {
    excel(res, map[type].file + '.xlsx', data);
  } else {
    csv(res, map[type].file + '.csv', data);
  }
});
app.get('/api/roles', auth, requirePermission('roles.manage'), (req,res)=>{ const roles=all('SELECT * FROM roles ORDER BY id'); roles.forEach(r=>r.permissions=all(`SELECT p.* FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=? ORDER BY p.code`,[r.id])); res.json(roles); });
app.get('/api/permissions', auth, requirePermission('roles.manage'), (req,res)=>res.json(all('SELECT * FROM permissions ORDER BY code')));
app.put('/api/roles/:id/permissions', auth, requirePermission('roles.manage'), (req,res)=>{ const role=get('SELECT * FROM roles WHERE id=?',[req.params.id]); if(!role) return res.status(404).json({error:'Không tìm thấy role'}); const ids=z.object({permission_ids:z.array(z.number())}).parse(req.body).permission_ids; const tx=db.transaction(()=>{ db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(role.id); const ins=db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES (?,?)'); ids.forEach(pid=>ins.run(role.id,pid)); audit(req.user.id,'update_permissions','role',role.id,{permission_ids:ids}); return all(`SELECT p.* FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=? ORDER BY p.code`,[role.id]); }); res.json({role,permissions:tx()}); });
app.get('/api/users', auth, requirePermission('users.view'), (req,res)=>res.json(all(`SELECT u.id,u.full_name,u.email,u.is_active,u.created_at,r.name role,r.id role_id FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id`)));
app.post('/api/users', auth, requirePermission('users.create'), (req,res)=>{ const s=z.object({full_name:z.string().min(1),email:z.string().email(),password:z.string().min(6),role_id:z.number(),is_active:z.number().optional()}).parse(req.body); const r=db.prepare('INSERT INTO users(full_name,email,password_hash,role_id,is_active) VALUES (?,?,?,?,?)').run(s.full_name,s.email,bcrypt.hashSync(s.password,10),s.role_id,s.is_active ?? 1); audit(req.user.id,'create','user',r.lastInsertRowid,{email:s.email,role_id:s.role_id}); res.status(201).json(get('SELECT id,full_name,email,role_id,is_active,created_at FROM users WHERE id=?',[r.lastInsertRowid])); });
app.put('/api/users/:id', auth, requirePermission('users.update'), (req,res)=>{ const old=get('SELECT * FROM users WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy user'}); const s={...old,...req.body}; const passwordHash=req.body.password?bcrypt.hashSync(req.body.password,10):old.password_hash; db.prepare('UPDATE users SET full_name=?,email=?,password_hash=?,role_id=?,is_active=? WHERE id=?').run(s.full_name,s.email,passwordHash,s.role_id,s.is_active?1:0,req.params.id); audit(req.user.id,'update','user',req.params.id,{email:s.email,role_id:s.role_id,is_active:s.is_active}); res.json(get('SELECT id,full_name,email,role_id,is_active,created_at FROM users WHERE id=?',[req.params.id])); });
app.delete('/api/users/:id', auth, requirePermission('users.delete'), (req,res)=>{ if(Number(req.params.id)===req.user.id) return res.status(400).json({error:'Không thể xóa chính mình'}); db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(req.params.id); audit(req.user.id,'deactivate','user',req.params.id); res.json({ok:true}); });
app.get('/api/audit-logs', auth, requirePermission('audit_logs.view'), (req,res)=>res.json(all(`SELECT l.*, u.full_name user_name FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 200`)));


// ─────────────────────────────────────────────────────────────
// CUSTOMER PORTAL APIS
// ─────────────────────────────────────────────────────────────

app.post('/api/customer/register', async (req, res) => {
  try {
    const s = z.object({
      full_name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      phone: z.string().optional()
    }).parse(req.body);
    const existing = get('SELECT id FROM customers WHERE email=?', [s.email]);
    if (existing) return res.status(400).json({ error: 'Email này đã được đăng ký.' });
    const hash = bcrypt.hashSync(s.password, 10);
    const result = db.prepare('INSERT INTO customers(full_name, email, password_hash, phone, type, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .run(s.full_name, s.email, hash, s.phone || null, 'retail');
    audit(null, 'create', 'customer', result.lastInsertRowid, { email: s.email });
    res.status(201).json({ ok: true, message: 'Đăng ký thành công. Vui lòng đăng nhập.' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/customer/login', (req, res) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const c = get('SELECT * FROM customers WHERE email=? AND is_active=1', [body.email]);
    if (!c || !c.password_hash || !bcrypt.compareSync(body.password, c.password_hash))
      return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });
    const token = jwt.sign({ id: c.id, email: c.email, fullName: c.full_name, full_name: c.full_name, type: 'customer' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, customer: { id: c.id, email: c.email, full_name: c.full_name, phone: c.phone, type: c.type } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/customer/me', customerAuth, (req, res) => {
  try {
    const c = get('SELECT id, full_name, email, phone, type, notes, created_at FROM customers WHERE id=?', [req.user.id]);
    if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    const orders = all('SELECT id, order_code, status, payment_method, subtotal, discount, tax, total, notes, created_at FROM orders WHERE customer_id=? ORDER BY created_at DESC', [c.id]);
    const reviews = all('SELECT r.id, r.book_id, r.rating, r.content, r.created_at, b.title book_title FROM reviews r LEFT JOIN books b ON b.id=r.book_id WHERE r.customer_id=? ORDER BY r.created_at DESC', [c.id]);
    res.json({
      id: c.id,
      full_name: c.full_name,
      phone: c.phone,
      email: c.email,
      type: c.type,
      notes: c.notes,
      created_at: c.created_at,
      orders: orders.map(o => ({
        id: o.id,
        order_code: o.order_code,
        status: o.status,
        payment_method: o.payment_method,
        subtotal: o.subtotal,
        discount: o.discount,
        tax: o.tax,
        total: o.total,
        notes: o.notes,
        created_at: o.created_at
      })),
      reviews: reviews.map(r => ({
        id: r.id,
        book_id: r.book_id,
        rating: r.rating,
        content: r.content,
        book_title: r.book_title,
        created_at: r.created_at
      }))
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/customer/books', customerAuth, (req, res) => {
  try {
    const list = all('SELECT b.id, b.code, b.title, a.name author, c.name category, b.sale_price, b.stock_quantity, b.description, b.is_active, b.cover_document_id FROM books b LEFT JOIN authors a ON a.id=b.author_id LEFT JOIN categories c ON c.id=b.category_id WHERE b.is_active=1 ORDER BY b.title ASC');
    res.json(list.map(b => ({
      id: b.id,
      code: b.code,
      title: b.title,
      author: b.author,
      category: b.category,
      sale_price: b.sale_price,
      stock_quantity: b.stock_quantity,
      description: b.description,
      is_active: b.is_active,
      cover_document_id: b.cover_document_id
    })));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/customer/orders', customerAuth, (req, res) => {
  try {
    const s = z.object({
      items: z.array(z.object({ book_id: z.number(), quantity: z.number().int().positive() })).min(1)
    }).parse(req.body);
    let subtotal = 0;
    const priced = [];
    
    const tx = db.transaction(() => {
      for (const item of s.items) {
        const b = get('SELECT * FROM books WHERE id=? AND is_active=1', [item.book_id]);
        if (!b) throw new Error('Sách không tồn tại hoặc đã ngưng bán');
        if (b.stock_quantity < item.quantity) throw new Error('Không đủ tồn kho: ' + b.title + ' (còn ' + b.stock_quantity + ')');
        const total = b.sale_price * item.quantity;
        subtotal += total;
        
        db.prepare('UPDATE books SET stock_quantity=stock_quantity-?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.quantity, b.id);
        priced.push({
          bookId: b.id,
          bookCode: b.code,
          bookTitle: b.title,
          quantity: item.quantity,
          unitPrice: b.sale_price,
          total
        });
      }
      
      const orderCode = 'ORD-' + Date.now();
      const r = db.prepare('INSERT INTO orders(order_code, customer_id, status, payment_method, subtotal, discount, tax, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(orderCode, req.user.id, 'paid', 'cash', subtotal, 0, 0, subtotal, 'Đặt mua trực tuyến qua cổng khách hàng');
      const orderId = r.lastInsertRowid;
      
      const insItem = db.prepare('INSERT INTO order_items(order_id, book_id, quantity, unit_price, total) VALUES (?, ?, ?, ?, ?)');
      priced.forEach(p => {
        insItem.run(orderId, p.bookId, p.quantity, p.unitPrice, p.total);
      });
      
      audit(null, 'create', 'order', orderId, { customer_id: req.user.id, items: priced });
      return { id: orderId, order_code: orderCode };
    });
    
    res.status(201).json(tx());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/customer/documents/:id/cover', customerAuth, (req, res) => {
  try {
    const d = get('SELECT * FROM documents WHERE id=?', [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    res.setHeader('Content-Type', d.mime_type);
    if (d.mime_type !== 'application/pdf') {
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(d.original_name) + '"');
    }
    fs.createReadStream(path.join(uploadDir, d.stored_name)).pipe(res);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/customer/books/:id', customerAuth, (req, res) => {
  try {
    const b = get('SELECT b.*, a.name author, c.name category, p.name publisher FROM books b LEFT JOIN authors a ON a.id=b.author_id LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN publishers p ON p.id=b.publisher_id WHERE b.id=?', [req.params.id]);
    if (!b) return res.status(404).json({ error: 'Không tìm thấy sách' });
    
    const orderIds = all('SELECT DISTINCT order_id FROM order_items WHERE book_id=?', [b.id]).map(o => o.order_id);
    const recommendations = [];
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const coBooks = all(`SELECT book_id, COUNT(*) co_count FROM order_items WHERE order_id IN (${placeholders}) AND book_id != ? GROUP BY book_id ORDER BY co_count DESC LIMIT 3`, [...orderIds, b.id]);
      for (const r of coBooks) {
        const book = get('SELECT b.id, b.title, a.name author, b.sale_price price FROM books b LEFT JOIN authors a ON a.id=b.author_id WHERE b.id=?', [r.book_id]);
        if (book) {
          recommendations.push({
            id: book.id,
            title: book.title,
            author: book.author,
            price: book.price,
            confidence: Math.round((r.co_count / orderIds.length) * 100)
          });
        }
      }
    }
    
    if (recommendations.length < 3 && b.author) {
      const existingIds = [b.id, ...recommendations.map(r => r.id)];
      const placeholders = existingIds.map(() => '?').join(',');
      const sameAuthor = all(`SELECT b.id, b.title, a.name author, b.sale_price price FROM books b LEFT JOIN authors a ON a.id=b.author_id WHERE a.name=? AND b.id NOT IN (${placeholders}) AND b.is_active=1 LIMIT ?`, [b.author, ...existingIds, 3 - recommendations.length]);
      sameAuthor.forEach(s => {
        recommendations.push({
          id: s.id,
          title: s.title,
          author: s.author,
          price: s.price,
          confidence: null
        });
      });
    }
    
    res.json({
      id: b.id,
      code: b.code,
      title: b.title,
      author: b.author,
      category: b.category,
      publisher: b.publisher,
      isbn: b.isbn,
      published_year: b.published_year,
      pages: b.pages,
      language: b.language,
      sale_price: b.sale_price,
      stock_quantity: b.stock_quantity,
      description: b.description,
      excerpt: b.excerpt,
      cover_document_id: b.cover_document_id,
      recommendations: recommendations.slice(0, 3)
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────
// CUSTOMER FEEDBACK & SENTIMENT APIS
// ─────────────────────────────────────────────────────────────

app.post('/api/customer/feedback', customerAuth, upload.array('images', 5), async (req, res) => {
  try {
    const { book_id, rating, comment, tags_json } = req.body;
    if (!rating || !comment) {
      return res.status(400).json({ error: 'Thiếu thông tin đánh giá' });
    }
    
    const ratingNum = parseInt(rating);
    const aiService = require('./ai-service');
    const sentiment = await aiService.analyzeFeedbackSentiment(comment);
    
    const isFeatured = (
      sentiment.sentiment === 'positive' && 
      ratingNum >= 4 && 
      sentiment.score >= 0.8
    );
    
    const status = (
      sentiment.sentiment === 'negative' && 
      ratingNum <= 2
    ) ? 'urgent' : 'new';
    
    const tags = tags_json || '[]';
    
    const result = db.prepare(`
      INSERT INTO feedback (customer_id, customer_name, email, book_id, rating, comment, tags, sentiment, score, is_featured, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id,
      req.user.full_name || req.user.fullName,
      req.user.email,
      book_id ? parseInt(book_id) : null,
      ratingNum,
      comment,
      tags,
      sentiment.sentiment,
      sentiment.score,
      isFeatured ? 1 : 0,
      status
    );
    
    const feedbackId = result.lastInsertRowid;
    
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const checksum = crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex');
        db.prepare(`
          INSERT INTO feedback_images (feedback_id, file_path, file_name, checksum, file_size_kb)
          VALUES (?, ?, ?, ?, ?)
        `).run(feedbackId, file.path, file.originalname, checksum, Math.round(file.size / 1024));
      }
    }
    
    audit(req.user.id, 'create', 'feedback', feedbackId, { book_id: book_id ? parseInt(book_id) : null, rating: ratingNum, sentiment: sentiment.sentiment });
    res.json({ id: feedbackId, sentiment, isFeatured, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/customer/feedback/book/:bookId', (req, res) => {
  try {
    const list = all(`
      SELECT f.*,
        (SELECT json_group_array(json_object('id', id, 'file_name', file_name))
         FROM feedback_images WHERE feedback_id = f.id) as images
      FROM feedback f
      WHERE f.book_id = ? AND f.status != 'urgent'
      ORDER BY f.is_featured DESC, f.created_at DESC
    `, [req.params.bookId]);
    
    res.json(list.map(f => ({
      id: f.id,
      customerName: f.customer_name,
      email: f.email,
      book_id: f.book_id,
      rating: f.rating,
      comment: f.comment,
      tags: f.tags ? JSON.parse(f.tags) : [],
      sentiment: f.sentiment,
      score: f.score,
      isFeatured: !!f.is_featured,
      status: f.status,
      createdAt: f.created_at,
      media: (f.images ? JSON.parse(f.images) : []).map(img => ({
        fileName: img.file_name,
        url: `/api/feedback/images/${img.id}`
      }))
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feedback/images/:id', (req, res) => {
  try {
    const img = get('SELECT * FROM feedback_images WHERE id = ?', [req.params.id]);
    if (!img) return res.status(404).json({ error: 'Image not found' });
    res.sendFile(path.resolve(img.file_path));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feedbacks', (req, res) => {
  try {
    const feedbacks = all(`
      SELECT f.*, b.title as book_title,
        (SELECT COUNT(*) FROM feedback_images WHERE feedback_id = f.id) as image_count
      FROM feedback f
      LEFT JOIN books b ON b.id = f.book_id
      ORDER BY 
        CASE WHEN f.status = 'urgent' THEN 0 ELSE 1 END,
        f.created_at DESC
    `);
    
    const mapped = feedbacks.map(f => {
      const imgs = all('SELECT * FROM feedback_images WHERE feedback_id = ?', [f.id]);
      return {
        id: f.id,
        bookId: f.book_id,
        customerId: f.customer_id,
        customerName: f.customer_name,
        email: f.email,
        rating: f.rating,
        comment: f.comment,
        tags: f.tags ? JSON.parse(f.tags) : [],
        sentiment: f.sentiment,
        score: f.score,
        isFeatured: !!f.is_featured,
        status: f.status,
        createdAt: f.created_at,
        media: imgs.map(img => ({
          fileName: img.file_name,
          url: `/api/feedback/images/${img.id}`
        }))
      };
    });

    res.json({
      list: mapped,
      total: feedbacks.length,
      page: 1,
      pages: 1
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feedbacks/stats', auth, requirePermission('customers.view'), (req, res) => {
  try {
    const stats = {
      totalFeedbacks: get('SELECT COUNT(*) as count FROM feedback').count,
      averageRating: get('SELECT AVG(rating) as avg FROM feedback').avg || 0,
      sentimentDistribution: all(`
        SELECT sentiment, COUNT(*) as count 
        FROM feedback 
        GROUP BY sentiment
      `),
      urgentCount: get("SELECT COUNT(*) as count FROM feedback WHERE status = 'urgent'").count,
      featuredCount: get('SELECT COUNT(*) as count FROM feedback WHERE is_featured = 1').count,
      withImagesCount: get('SELECT COUNT(DISTINCT feedback_id) as count FROM feedback_images').count
    };
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/feedbacks/:id/status', auth, requirePermission('customers.update'), (req, res) => {
  try {
    const { status } = req.body;
    db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, req.params.id);
    audit(req.user.id, 'update_status', 'feedback', req.params.id, { status });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feedbacks/:id/feature', auth, requirePermission('customers.update'), (req, res) => {
  try {
    db.prepare('UPDATE feedback SET is_featured = 1 WHERE id = ?').run(req.params.id);
    audit(req.user.id, 'feature', 'feedback', req.params.id, {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/feedbacks/:id/status', auth, requirePermission('books.update', 'customers.update'), (req, res) => {
  try {
    const { status } = req.body;
    if (status && ['new', 'reviewed', 'resolved'].includes(status)) {
      db.prepare('UPDATE feedback SET status = ? WHERE id = ?').run(status, req.params.id);
      audit(req.user.id, 'update_status', 'feedback', req.params.id, { status });
      const f = get('SELECT * FROM feedback WHERE id = ?', [req.params.id]);
      res.json({
        id: f.id,
        bookId: f.book_id,
        customerId: f.customer_id,
        customerName: f.customer_name,
        email: f.email,
        rating: f.rating,
        comment: f.comment,
        tags: f.tags ? JSON.parse(f.tags) : [],
        sentiment: f.sentiment,
        score: f.score,
        isFeatured: !!f.is_featured,
        status: f.status,
        createdAt: f.created_at
      });
    } else {
      res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/feedbacks/:id/featured', auth, requirePermission('books.update', 'customers.update'), (req, res) => {
  try {
    const { isFeatured } = req.body;
    const isFeat = isFeatured === true || isFeatured === 1 || isFeatured === 'true';
    db.prepare('UPDATE feedback SET is_featured = ? WHERE id = ?').run(isFeat ? 1 : 0, req.params.id);
    audit(req.user.id, 'update_status', 'feedback', req.params.id, { isFeatured: isFeat });
    const f = get('SELECT * FROM feedback WHERE id = ?', [req.params.id]);
    res.json({
      id: f.id,
      bookId: f.book_id,
      customerId: f.customer_id,
      customerName: f.customer_name,
      email: f.email,
      rating: f.rating,
      comment: f.comment,
      tags: f.tags ? JSON.parse(f.tags) : [],
      sentiment: f.sentiment,
      score: f.score,
      isFeatured: !!f.is_featured,
      status: f.status,
      createdAt: f.created_at
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/feedbacks/:id', auth, requirePermission('books.update', 'customers.update'), (req, res) => {
  try {
    const f = get('SELECT * FROM feedback WHERE id = ?', [req.params.id]);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy phản hồi' });
    
    // Find associated images and delete from disk
    const imgs = all('SELECT * FROM feedback_images WHERE feedback_id = ?', [req.params.id]);
    imgs.forEach(img => {
      try {
        if (fs.existsSync(img.file_path)) {
          fs.unlinkSync(img.file_path);
        }
      } catch (err) {
        console.error('Lỗi khi xóa file ảnh phản hồi:', err.message);
      }
    });

    db.prepare('DELETE FROM feedback_images WHERE feedback_id = ?').run(req.params.id);
    db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
    
    audit(req.user.id, 'delete', 'feedback', req.params.id, { customerName: f.customer_name });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────
// LOG FILE SERVICE APIS
// ─────────────────────────────────────────────────────────────

app.get('/api/logs', auth, requirePermission('audit.view'), (req, res) => {
  try {
    res.json(logService.listLogFiles());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs/range/export', auth, requirePermission('audit.view'), (req, res) => {
  const { from, to, format } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Cần truyền from và to (YYYY-MM-DD)' });
  try {
    if (format === 'csv' || format === 'xlsx') {
      const list = all('SELECT l.*, u.full_name user_name, u.email user_email FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE date(l.created_at) BETWEEN ? AND ? ORDER BY l.created_at ASC', [from, to]);
      const rows = list.map(l => ({
        'Thời gian': l.created_at,
        'Người dùng': l.user_name || 'system',
        'Email': l.user_email || '',
        'Hành động': l.action,
        'Đối tượng': l.entity_type || '',
        'ID đối tượng': l.entity_id || '',
        'Chi tiết': l.details || ''
      }));
      const filename = `activity-log-${from}-to-${to}`;
      if (format === 'xlsx') return excel(res, filename + '.xlsx', rows);
      return csv(res, filename + '.csv', rows);
    }
    const content = logService.readLogRange(from, to);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-log-${from}-to-${to}.log"`);
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs/:date', auth, requirePermission('audit.view'), (req, res) => {
  const { date } = req.params;
  const keyword = req.query.q || '';
  try {
    const lines = logService.searchLog(date, keyword);
    res.json({ date, lines, total: lines.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs/:date/download', auth, requirePermission('audit.view'), (req, res) => {
  const { date } = req.params;
  try {
    const logPath = logService.getLogFilePath ? logService.getLogFilePath(date) : path.join(logService.LOG_DIR, `${date}.log`);
    if (!fs.existsSync(logPath)) return res.status(404).json({ error: 'Không tìm thấy file log' });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-&{date}.log"`);
    fs.createReadStream(logPath).pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// UNSTRUCTURED REPORT DOCUMENT APIS
// ─────────────────────────────────────────────────────────────

app.get('/api/reports', auth, requirePermission('reports.view_basic'), (req, res) => {
  try {
    const list = all('SELECT id, title, file_name, file_type, file_size_kb, uploaded_by, notes, created_at FROM reports ORDER BY created_at DESC');
    res.json(list.map(r => ({
      id: r.id,
      title: r.title,
      fileName: r.file_name,
      fileType: r.file_type,
      fileSizeKB: r.file_size_kb,
      uploadedBy: r.uploaded_by,
      notes: r.notes,
      created_at: r.created_at
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reports', auth, requirePermission('reports.view_financial'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Không tìm thấy file tải lên' });
    const notes = req.body.notes || '';
    const title = req.body.title || req.file.originalname;
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const validExts = ['csv', 'xlsx', 'pdf', 'txt'];
    if (!validExts.includes(ext)) {
      return res.status(400).json({ error: 'Định dạng file không được hỗ trợ. Cần: csv, xlsx, pdf, txt' });
    }
    
    const fileBuffer = fs.readFileSync(req.file.path);
    const r = db.prepare('INSERT INTO reports(title, file_name, file_type, file_size_kb, file_data, uploaded_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(title, req.file.originalname, ext, Math.round(req.file.size / 1024), fileBuffer, req.user.full_name || req.user.fullName, notes);
    
    // Clean up temporary local file
    try { fs.unlinkSync(req.file.path); } catch (err) {}
      
    audit(req.user.id, 'upload', 'report', r.lastInsertRowid, { title, fileName: req.file.originalname });
    res.status(201).json({ id: r.lastInsertRowid, title });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/reports/:id/download', auth, requirePermission('reports.view_basic'), (req, res) => {
  try {
    const r = get('SELECT * FROM reports WHERE id=?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    const mimeTypes = {
      pdf: 'application/pdf',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain'
    };
    const mime = mimeTypes[r.file_type] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(r.file_name)}"`);
    res.send(r.file_data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/reports/:id', auth, requirePermission('reports.view_financial'), (req, res) => {
  try {
    const r = get('SELECT * FROM reports WHERE id=?', [req.params.id]);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    db.prepare('DELETE FROM reports WHERE id=?').run(req.params.id);
    audit(req.user.id, 'delete', 'report', req.params.id, { title: r.title });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// AI & INTENT HANDLING ENDPOINTS
// ─────────────────────────────────────────────────────────────

// AI Book Management Session Store
const bookSessions = new Map();
function getBookSession(userId) { return bookSessions.get(userId); }
function setBookSession(userId, data) { bookSessions.set(userId, { ...data, timestamp: Date.now() }); }
function clearBookSession(userId) { bookSessions.delete(userId); }

async function executeCreateBook(req, res, session) {
  const info = session.bookInfo;
  const maxRow = get("SELECT MAX(id) AS maxId FROM books");
  const nextId = (maxRow && maxRow.maxId) ? maxRow.maxId + 1 : 1;
  const code = 'BOOK-' + String(nextId).padStart(3, '0');
  const importPrice = info.import_price || 0;
  const salePrice = info.sale_price || 0;

  const author_id = info.author ? upsertName('authors', info.author) : null;
  const category_id = info.category ? upsertName('categories', info.category) : null;
  const publisher_id = info.publisher ? upsertName('publishers', info.publisher) : null;

  const r = db.prepare(`INSERT INTO books(id,code,title,author_id,category_id,publisher_id,isbn,published_year,pages,language,import_price,sale_price,stock_quantity,description,excerpt,tags,is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,1)`)
    .run(nextId, code, info.title, author_id, category_id, publisher_id, info.isbn || null, info.published_year || null, info.pages || null, info.language || 'vi', importPrice, salePrice, info.description || null, info.excerpt || null, JSON.stringify(info.tags || []));

  const bookId = nextId;
  rebuildBookIndex(bookId);
  audit(req.user.id, 'create', 'book', bookId, { title: info.title, source: 'ai_chat' });
  clearBookSession(req.user.id);
  res.json({
    answer: '✅ Đã thêm sách **' + info.title + '** vào thư viện thành công!\nMã sách: ' + code + '\nGiá nhập: ' + money(importPrice) + ' | Giá bán: ' + money(salePrice) + '\nBạn có thể xem trong tab Sách nhé.',
    sources: [],
    action: 'create_success'
  });
}

async function executeToggleActive(req, res, session) {
  const val = session.actionValue;
  const book = get('SELECT * FROM books WHERE id=?', [session.bookId]);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });

  db.prepare('UPDATE books SET is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(val, session.bookId);
  rebuildBookIndex(session.bookId);

  audit(req.user.id, 'update', 'book', session.bookId, { is_active: val, source: 'ai_chat' });
  clearBookSession(req.user.id);
  const label = val ? 'mở bán lại' : 'ngưng bán';
  res.json({ answer: '✅ Đã ' + label + ' sách **' + session.bookTitle + '** thành công!', sources: [], action: 'toggle_success' });
}

async function executeAdjustPrice(req, res, session) {
  const book = get('SELECT * FROM books WHERE id=?', [session.bookId]);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });

  db.prepare('UPDATE books SET sale_price=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(session.newPrice, session.bookId);
  rebuildBookIndex(session.bookId);

  audit(req.user.id, 'update', 'book', session.bookId, { sale_price: session.newPrice, old_price: session.oldPrice, source: 'ai_chat' });
  clearBookSession(req.user.id);
  res.json({ answer: '✅ Đã cập nhật giá sách **' + session.bookTitle + '**: ' + money(session.oldPrice) + ' → ' + money(session.newPrice), sources: [], action: 'price_success' });
}

async function executeAdjustStock(req, res, session) {
  const book = get('SELECT * FROM books WHERE id=?', [session.bookId]);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });

  const delta = session.actionValue === 'out' ? -session.quantity : session.quantity;
  db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(delta, session.bookId);
  
  const lastSlip = get("SELECT slip_code FROM inventory_slips ORDER BY CAST(SUBSTR(slip_code, 8) AS INTEGER) DESC LIMIT 1");
  let lastNum = 0;
  if (lastSlip && lastSlip.slip_code && lastSlip.slip_code.startsWith('SLIP-')) {
    lastNum = parseInt(lastSlip.slip_code.replace('SLIP-', '')) || 0;
  }
  const slipCode = 'SLIP-' + String(lastNum + 1).padStart(3, '0');

  const slipR = db.prepare('INSERT INTO inventory_slips(slip_code, type, note, created_by) VALUES (?, ?, ?, ?)')
    .run(slipCode, session.actionValue === 'out' ? 'out' : 'in', 'AI Chat adjustment', req.user.id);
  
  db.prepare('INSERT INTO inventory_transactions(slip_id, book_id, type, quantity, unit_cost, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(slipR.lastInsertRowid, session.bookId, session.actionValue === 'out' ? 'out' : 'in', Math.abs(delta), book.import_price || 0, 'AI Chat adjustment', req.user.id);

  rebuildBookIndex(session.bookId);

  audit(req.user.id, 'update', 'book', session.bookId, { stock_delta: delta, source: 'ai_chat' });
  const newStock = session.oldStock + delta;
  clearBookSession(req.user.id);
  res.json({ answer: '✅ Đã ' + (session.actionValue === 'out' ? 'xuất' : 'nhập') + ' ' + session.quantity + ' cuốn **' + session.bookTitle + '**.\nTồn kho: ' + session.oldStock + ' → ' + newStock + ' cuốn.', sources: [], action: 'stock_success' });
}

async function executeUpdateInfo(req, res, session) {
  const field = session.field;
  const book = get('SELECT * FROM books WHERE id=?', [session.bookId]);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });

  const validFields = { title: 1, description: 1, isbn: 1, excerpt: 1 };
  if (!validFields[field]) return res.json({ answer: 'Không thể cập nhật trường "' + field + '".', sources: [] });

  db.prepare(`UPDATE books SET ${field}=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(session.value, session.bookId);
  rebuildBookIndex(session.bookId);

  audit(req.user.id, 'update', 'book', session.bookId, { field: field, value: session.value, source: 'ai_chat' });
  clearBookSession(req.user.id);
  res.json({ answer: '✅ Đã cập nhật ' + field + ' của sách **' + session.bookTitle + '** thành công!', sources: [], action: 'update_success' });
}

app.post('/api/ai/classify/:id', auth, requirePermission('documents.update'), async (req, res) => {
  try {
    const d = get('SELECT * FROM documents WHERE id=?', [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (!d.extracted_text) return res.status(400).json({ error: 'Tài liệu chưa được trích xuất văn bản' });

    const aiService = require('./ai-service');
    const result = await aiService.classifyDocument(d.extracted_text);
    db.prepare('UPDATE documents SET doc_type=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(result.type, d.id);
    
    setDocumentMetadata(d.id, {
      aiConfidence: String(result.confidence),
      aiClassifiedAt: new Date().toISOString()
    });

    rebuildDocumentIndex(d.id);

    await audit(req.user.id, 'ai_classify', 'document', d.id, { from: d.doc_type, to: result.type, confidence: result.confidence });
    res.json({ document_id: d.id, doc_type: result.type, confidence: result.confidence, previous: d.doc_type });
  } catch (e) {
    res.status(500).json({ error: 'AI classification thất bại: ' + e.message });
  }
});

app.post('/api/ai/summarize/:id', auth, requirePermission('documents.update'), async (req, res) => {
  try {
    const d = get('SELECT * FROM documents WHERE id=?', [req.params.id]);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    const text = d.extracted_text || d.notes;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Tài liệu không có nội dung để tóm tắt' });

    const aiService = require('./ai-service');
    const result = await aiService.summarizeDocument(text);
    const now = new Date().toISOString();

    setDocumentMetadata(d.id, {
      ai_summary: result.summary,
      ai_summarized_at: now
    });

    rebuildDocumentIndex(d.id);

    await audit(req.user.id, 'ai_summarize', 'document', d.id);
    res.json({ document_id: d.id, summary: result.summary, summarized_at: now });
  } catch (e) {
    res.status(500).json({ error: 'AI tóm tắt thất bại: ' + e.message });
  }
});

app.post('/api/ai/chat', auth, requirePermission('search.use'), async (req, res) => {
  const { question, history } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: 'Câu hỏi trống' });
  try {
    const vnStopWords = new Set(['có', 'những', 'nào', 'và', 'của', 'là', 'các', 'được', 'một', 'cho', 'với', 'không', 'trong', 'khi', 'về', 'từ', 'đã', 'sẽ', 'đang', 'nên', 'vì', 'hoặc', 'như', 'lại', 'ra', 'đó', 'ấy', 'này', 'thì', 'mà', 'bởi', 'đến', 'qua', 'sau', 'trước', 'trên', 'dưới', 'tại', 'theo', 'bằng', 'cả', 'tôi', 'anh', 'chị', 'em', 'chúng', 'người', 'gì', 'sao', 'bao', 'nhiêu', 'nhiều', 'mấy', 'đều', 'cùng', 'vẫn', 'cứ', 'hãy', 'đừng', 'chớ', 'rất', 'hơi', 'quá', 'lắm', 'mới', 'vừa', 'đây', 'đâu', 'hay', 'còn', 'nữa', 'thêm', 'ngay', 'luôn', 'tất', 'nhưng', 'hôm', 'thế', 'chưa']);
    const words = question
      .replace(/[^\w\s\dàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, ' ')
      .trim().split(/\s+/)
      .filter(w => w.length > 1 && !vnStopWords.has(w.toLowerCase()));

    let dbBooks = [];
    if (words.length >= 1) {
      const likes = words.map(w => `%${w}%`);
      const placeholders = likes.map(() => 'title LIKE ? OR author LIKE ?').join(' OR ');
      const params = [];
      likes.forEach(l => params.push(l, l));
      dbBooks = all(`
        SELECT b.id, b.code, b.title, a.name author, b.sale_price, b.stock_quantity, b.is_active, b.description
        FROM books b
        LEFT JOIN authors a ON a.id=b.author_id
        WHERE ${placeholders}
        LIMIT 5
      `, params);
      
      if (dbBooks.length > 1) {
        const qLower = question.toLowerCase();
        dbBooks.sort(function(a, b) {
          var aT = (a.title && a.title.toLowerCase().indexOf(qLower) >= 0) ? 3 : 0;
          var aA = (a.author && a.author.toLowerCase().indexOf(qLower) >= 0) ? 1 : 0;
          var bT = (b.title && b.title.toLowerCase().indexOf(qLower) >= 0) ? 3 : 0;
          var bA = (b.author && b.author.toLowerCase().indexOf(qLower) >= 0) ? 1 : 0;
          return (bT + bA) - (aT + aA);
        });
      }
    }

    let session = getBookSession(req.user.id);
    if (session && session.step !== 'done') {
      const newFlow = /^(thêm|nhập|tạo|add\b|add\s+book|tăng\s+giá|giảm\s+giá|ngưng\s+bán|ngừng\s+bán|sửa\s+mô\s+tả|nhập\s+thêm|xuất\s+kho|mở\s+bán)\b/i.test(question.trim());
      if (newFlow) {
        clearBookSession(req.user.id);
        session = null;
      }
    }
    const wasWarned = (history || []).some(m => m.role === 'assistant' && (m.content.toLowerCase().includes('đừng hỏi lung tung') || m.content.includes('Đã bảo tốn token')));

    const hasBookMgmtKeyword = /thêm|nhập|tạo|ngưng|ngừng|dừng|ẩn|gỡ|xóa|mở bán|kích hoạt|cho lên|tăng giá|giảm giá|hạ giá|up giá|sale giá|nhập thêm|xuất kho|tồn|sửa|đổi|cập nhật|chỉnh|điều chỉnh|được|ok|oke|okey|ừ|duyệt|chốt|thực hiện|làm đi|\badd\b|add book|hủy|không|bỏ|thôi/i;
    const looksLikeBookMgmt = hasBookMgmtKeyword.test(question) || (session && session.step !== 'done');

    let processedQuestion = question;
    if (question.length > 300) {
      processedQuestion = question.slice(0, 200);
    }
    const qParts = processedQuestion.split(/\s+/);
    const qSeen = new Set();
    const qDeduped = [];
    qParts.forEach(w => {
      const lower = w.toLowerCase();
      if (!qSeen.has(lower)) { qSeen.add(lower); qDeduped.push(w); }
    });
    processedQuestion = qDeduped.join(' ');

    if (looksLikeBookMgmt) {
      const mappedDbBooks = dbBooks.map(b => ({
        id: b.id.toString(),
        code: b.code,
        title: b.title,
        author: b.author,
        sale_price: b.sale_price,
        stock_quantity: b.stock_quantity,
        is_active: b.is_active,
        description: b.description
      }));
      
      const aiService = require('./ai-service');
      const intent = await aiService.parseBookIntent(processedQuestion, mappedDbBooks, session);

      const newIntents = ['add_book', 'adjust_price', 'adjust_stock', 'toggle_active', 'update_info'];
      if (newIntents.includes(intent.intent)) {
        clearBookSession(req.user.id);
        session = null;
      }

      // Check permissions for parsed intents to prevent Privilege Escalation
      if (intent.intent === 'add_book' && !req.user.permissions.includes('books.create')) {
        return res.json({ answer: '❌ Bạn không có quyền thêm sách mới.', sources: [], action: 'error' });
      }
      if (intent.intent === 'toggle_active' && !req.user.permissions.includes('books.update')) {
        const actionVerb = intent.action === 'activate' ? 'mở bán lại' : 'ngưng bán';
        return res.json({ answer: '❌ Bạn không có quyền ' + actionVerb + ' sách.', sources: [], action: 'error' });
      }
      if (intent.intent === 'adjust_price' && !req.user.permissions.includes('books.update')) {
        return res.json({ answer: '❌ Bạn không có quyền cập nhật giá bán của sách.', sources: [], action: 'error' });
      }
      if (intent.intent === 'adjust_stock' && !req.user.permissions.includes('inventory.adjust')) {
        return res.json({ answer: '❌ Bạn không có quyền điều chỉnh số lượng tồn kho.', sources: [], action: 'error' });
      }
      if (intent.intent === 'update_info' && !req.user.permissions.includes('books.update')) {
        return res.json({ answer: '❌ Bạn không có quyền cập nhật thông tin sách.', sources: [], action: 'error' });
      }

      if (intent.intent === 'irrelevant' && hasBookMgmtKeyword.test(question)) {
        const retry = await aiService.parseBookIntent('Thêm sách: ' + question.replace(/\s+/g, ' ').trim(), mappedDbBooks, session);
        if (retry.intent === 'add_book') Object.assign(intent, retry);
      }

      if (/\b(mở bán lại|cho lên kệ|kích hoạt lại|bán lại)\b/i.test(question) && intent.intent !== 'confirm' && intent.intent !== 'reject') {
        const bookId = dbBooks.length > 0 ? dbBooks[0].id.toString() : null;
        if (bookId) {
          intent.intent = 'toggle_active';
          intent.book_id = bookId;
          intent.action = 'activate';
        }
      }

      if ((intent.intent === 'adjust_price' || intent.intent === 'adjust_stock' || intent.intent === 'toggle_active' || intent.intent === 'update_info') && !intent.book_id && dbBooks.length > 0) {
        intent.book_id = dbBooks[0].id.toString();
      }

      if (intent.intent === 'adjust_price' && intent.new_price && intent.new_price < 1000) {
        intent.new_price = intent.new_price * 1000;
      }

      if (session && session.step === 'awaiting_price' && intent.intent !== 'set_price' && intent.intent !== 'confirm' && intent.intent !== 'reject') {
        const priceMatch = question.match(/(\d{2,7})\s*k/i) || question.match(/(\d{2,7})\s*(?:đồng|nghìn|ngàn|tr|triệu)/i);
        if (priceMatch) {
          let rawPrice = parseInt(priceMatch[1]);
          if (rawPrice < 1000) rawPrice = rawPrice * 1000;
          intent.intent = 'set_price';
          intent.import_price = rawPrice;
          intent.sale_price = null;
        }
      }

      if (session && session.step === 'awaiting_confirm' && intent.intent !== 'confirm' && intent.intent !== 'reject') {
        const trimmed = question.trim();
        const shortConfirm = trimmed.length < 50 && /^(ok|oke|okey|ừ|ờ|ukm|duyệt|đồng ý|được|chốt|yes|yess|thực hiện|thêm đi|làm đi)\.*$/i.test(trimmed);
        const containsConfirm = /\b(ok|oke|okey|ừ|ờ|ukm|duyệt|đồng ý|chốt|yes|yess)\b/i.test(trimmed);
        if (shortConfirm || containsConfirm) {
          intent.intent = 'confirm';
        }
      }

      if (intent.intent === 'add_book' && intent.book_name) {
        intent.book_name = intent.book_name
          .replace(/\b(thêm sách|nhập sách|cuốn|quyển|con|dùm|giúp|đi|nha|nhe)\b/gi, '')
          .replace(/\b(\w+)\s+\1\b/g, '$1')
          .replace(/^\d+\s+/, '')
          .replace(/\s{2,}/g, ' ')
          .replace(/blah.*/gi, '')
          .trim();
      }

      if (intent.intent === 'set_price' && !session) {
        const aiHistory = (history || []).filter(m => m.role === 'assistant');
        const hadBookSearch = aiHistory.some(m => m.content.includes('thêm sách') || m.content.includes('tra cứu') || m.content.includes('thông tin sách'));
        if (hadBookSearch || intent.import_price) {
          return res.json({ answer: 'Bạn muốn thêm sách nào với giá ' + (intent.import_price ? money(intent.import_price) : 'đó') + '? Hãy nói "thêm sách [tên sách]" nhé.', sources: [], action: 'ask_book_name' });
        }
      }

      if (intent.intent === 'add_book' && intent.book_name) {
        const aiService = require('./ai-service');
        const bookInfo = await aiService.lookupBookInfo(intent.book_name);
        if (bookInfo.error) {
          return res.json({ answer: 'Không tìm thấy thông tin sách "' + intent.book_name + '". Bạn thử dùng tên đầy đủ hoặc tên khác nhé 😊', sources: [], action: 'ask_clarify' });
        }
        setBookSession(req.user.id, { step: 'awaiting_price', bookInfo: bookInfo, pendingAction: 'create_book' });
        return res.json({ answer: (intent.message || 'Tôi tìm thấy thông tin sách sau:') + '\n\n📖 **' + bookInfo.title + '**\n✍️ ' + (bookInfo.author || 'Chưa rõ') + '\n💰 Giá tham khảo: ' + (bookInfo.estimated_price ? money(bookInfo.estimated_price) : 'Chưa có') + '\n\nBạn muốn nhập giá bao nhiêu? (nhập 1 số, VD: 90000 hoặc 90k)', sources: [], action: 'search_result', book_info: bookInfo });
      }

      if (intent.intent === 'set_price' && session && session.step === 'awaiting_price') {
        session.bookInfo.import_price = intent.import_price || 0;
        session.bookInfo.sale_price = intent.sale_price || Math.round((intent.import_price || 0) * 1.15);
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookInfo: session.bookInfo, pendingAction: 'create_book' });
        const info = session.bookInfo;
        return res.json({ answer: 'Đã nhận giá. Xác nhận thêm sách:\n\n━━━━━━━━━━━━━━━━\n📖 ' + info.title + '\n✍️ ' + (info.author || '?') + '\n📚 ' + (info.category || '?') + '\n💰 Giá nhập: ' + money(info.import_price) + '\n💰 Giá bán: ' + money(info.sale_price) + '\n━━━━━━━━━━━━━━━━\n\nBạn muốn thêm sách này chứ?', sources: [], action: 'confirm_create', book_info: info });
      }

      if (intent.intent === 'confirm' && session) {
        if (session.pendingAction === 'create_book') {
          if (!req.user.permissions.includes('books.create')) {
            clearBookSession(req.user.id);
            return res.json({ answer: '❌ Bạn không có quyền thực hiện hành động này.', sources: [], action: 'error' });
          }
          return await executeCreateBook(req, res, session);
        }
        if (session.pendingAction === 'toggle_active') {
          if (!req.user.permissions.includes('books.update')) {
            clearBookSession(req.user.id);
            return res.json({ answer: '❌ Bạn không có quyền thực hiện hành động này.', sources: [], action: 'error' });
          }
          return await executeToggleActive(req, res, session);
        }
        if (session.pendingAction === 'adjust_price') {
          if (!req.user.permissions.includes('books.update')) {
            clearBookSession(req.user.id);
            return res.json({ answer: '❌ Bạn không có quyền thực hiện hành động này.', sources: [], action: 'error' });
          }
          return await executeAdjustPrice(req, res, session);
        }
        if (session.pendingAction === 'adjust_stock') {
          if (!req.user.permissions.includes('inventory.adjust')) {
            clearBookSession(req.user.id);
            return res.json({ answer: '❌ Bạn không có quyền thực hiện hành động này.', sources: [], action: 'error' });
          }
          return await executeAdjustStock(req, res, session);
        }
        if (session.pendingAction === 'update_info') {
          if (!req.user.permissions.includes('books.update')) {
            clearBookSession(req.user.id);
            return res.json({ answer: '❌ Bạn không có quyền thực hiện hành động này.', sources: [], action: 'error' });
          }
          return await executeUpdateInfo(req, res, session);
        }
      }

      if (intent.intent === 'reject') {
        clearBookSession(req.user.id);
        return res.json({ answer: 'Đã hủy. Bạn muốn làm gì khác không?', sources: [], action: 'cancelled' });
      }

      if (intent.intent === 'toggle_active') {
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0].id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này trong hệ thống.', sources: [] });
        const book = get('SELECT * FROM books WHERE id=?', [bookId]);
        const actionVerb = intent.action === 'activate' ? 'mở bán lại' : 'ngưng bán';
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'toggle_active', actionValue: intent.action === 'activate' ? 1 : 0, actionLabel: actionVerb, bookTitle: book.title });
        return res.json({ answer: intent.message || ('Bạn muốn ' + actionVerb + ' sách "' + book.title + '" (đang ' + (book.is_active ? 'bán' : 'ngưng bán') + ', tồn ' + book.stock_quantity + ' cuốn) phải không?'), sources: [], action: 'confirm_toggle', book_id: bookId });
      }

      if (intent.intent === 'adjust_price' && intent.new_price) {
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0].id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này.', sources: [] });
        const book = get('SELECT * FROM books WHERE id=?', [bookId]);
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'adjust_price', newPrice: intent.new_price, oldPrice: book.sale_price, bookTitle: book.title });
        return res.json({ answer: intent.message || ('Giá hiện tại của "' + book.title + '": ' + money(book.sale_price) + ' → Giá mới: ' + money(intent.new_price) + '. Xác nhận?'), sources: [], action: 'confirm_price', book_id: bookId });
      }

      if (intent.intent === 'adjust_stock' && intent.quantity) {
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0].id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này.', sources: [] });
        const book = get('SELECT * FROM books WHERE id=?', [bookId]);
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'adjust_stock', quantity: intent.quantity, actionValue: intent.action || 'in', oldStock: book.stock_quantity, bookTitle: book.title });
        const verb = (intent.action === 'out') ? 'xuất' : 'nhập';
        const newStock = (intent.action === 'out') ? book.stock_quantity - intent.quantity : book.stock_quantity + intent.quantity;
        return res.json({ answer: intent.message || ('Tồn hiện tại: ' + book.stock_quantity + ' → Sau khi ' + verb + ' ' + intent.quantity + ': ' + newStock + ' cuốn. Xác nhận?'), sources: [], action: 'confirm_stock', book_id: bookId });
      }

      if (intent.intent === 'update_info' && intent.field && intent.value) {
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0].id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này.', sources: [] });
        const book = get('SELECT * FROM books WHERE id=?', [bookId]);
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'update_info', field: intent.field, value: intent.value, bookTitle: book.title });
        return res.json({ answer: intent.message || ('Cập nhật ' + intent.field + ' của "' + book.title + '" thành: ' + intent.value + '. Xác nhận?'), sources: [], action: 'confirm_update', book_id: bookId });
      }
    }

    // ── Fallback: Document RAG Search ──
    const searchResults = [];
    if (words.length >= 1) {
      const likes = words.map(w => `%${w}%`);
      const placeholders = likes.map(() => 'title LIKE ? OR description LIKE ?').join(' OR ');
      const params = [];
      likes.forEach(l => params.push(l, l));
      const matchedBooks = all(`SELECT id, title, description FROM books WHERE ${placeholders} LIMIT 3`, params);
      matchedBooks.forEach(b => {
        searchResults.push({ entity_type: 'book', entity_id: b.id.toString(), title: b.title, snippet: b.description ? b.description.slice(0, 120) : '', rank: 0 });
      });

      const docPlaceholders = likes.map(() => 'title LIKE ? OR notes LIKE ? OR extracted_text LIKE ?').join(' OR ');
      const docParams = [];
      likes.forEach(l => docParams.push(l, l, l));
      const matchedDocs = all(`SELECT id, title, notes FROM documents WHERE ${docPlaceholders} LIMIT 5`, docParams);
      matchedDocs.forEach(d => {
        searchResults.push({ entity_type: 'document', entity_id: d.id.toString(), title: d.title, snippet: d.notes ? d.notes.slice(0, 120) : '', rank: 0 });
      });
    }

    const contextDocs = [];
    for (const r of searchResults.slice(0, 5)) {
      if (r.entity_type === 'document') {
        const doc = get('SELECT * FROM documents WHERE id=?', [r.entity_id]);
        if (doc) {
          contextDocs.push({
            id: doc.id,
            title: doc.title,
            doc_type: doc.doc_type,
            snippet: r.snippet,
            text: (doc.extracted_text || '').slice(0, 1500)
          });
        }
      } else if (r.entity_type === 'book') {
        const book = get('SELECT * FROM books WHERE id=?', [r.entity_id]);
        if (book) {
          contextDocs.push({
            id: book.id,
            title: book.title,
            doc_type: 'book',
            snippet: r.snippet,
            text: 'Sách: ' + book.title + '. Giá bán: ' + money(book.sale_price) + '. Tồn kho: ' + book.stock_quantity + ' cuốn. ' + (book.is_active ? 'Đang bán.' : 'Đã ngưng bán.') + (book.description ? ' Mô tả: ' + book.description : '')
          });
        }
      }
    }

    if (wasWarned) {
      const bookKeywords = ['sách', 'tài liệu', 'hóa đơn', 'hợp đồng', 'nhập', 'kho', 'tác giả', 'nxb', 'giá', 'tồn', 'bìa', 'mô tả', 'phản hồi', 'đơn hàng', 'khách hàng', 'nhà cung cấp', 'phiếu', 'bán', 'mua', 'đánh giá', 'kiểm kê', 'xuất bản', 'nhà sách'];
      const qLower = question.toLowerCase();
      if (!bookKeywords.some(kw => qLower.includes(kw))) {
        return res.json({ answer: 'Đã bảo tốn token mà 😤', sources: [] });
      }
    }
    
    const aiService = require('./ai-service');
    const result = await aiService.chatWithContext(question, contextDocs, history || []);
    res.json({ answer: result.answer, sources: contextDocs.map(d => ({ document_id: d.id, title: d.title, doc_type: d.doc_type, snippet: d.snippet })) });
  } catch (e) {
    res.status(500).json({ error: 'AI chat thất bại: ' + e.message });
  }
});


app.use((err, req, res, next) => res.status(400).json({ error: err.message || 'Lỗi hệ thống' }));

function syncBookStocks() {
  try {
    const initialStocks = {
      1: 25, 2: 18, 3: 14, 4: 30, 5: 22, 6: 10, 7: 8, 8: 28, 9: 11, 10: 16,
      11: 9, 12: 20, 13: 17, 14: 24, 15: 13, 16: 26, 17: 19, 18: 12, 19: 7, 20: 5,
      21: 21, 22: 15, 23: 32, 24: 23, 25: 18, 26: 14, 27: 6, 28: 17, 29: 16, 30: 20
    };
    const books = all('SELECT id, code, title, stock_quantity FROM books');
    db.transaction(() => {
      books.forEach(b => {
        const init = initialStocks[b.id] || 0;
        const slipsSum = get("SELECT COALESCE(SUM(quantity), 0) s FROM inventory_transactions WHERE book_id=? AND type IN ('in', 'out', 'adjust', 'reverse')", [b.id]).s;
        const salesSum = get("SELECT COALESCE(SUM(oi.quantity), 0) s FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.book_id=? AND o.status != 'cancelled'", [b.id]).s;
        const correctStock = init + slipsSum - salesSum;
        if (b.stock_quantity !== correctStock) {
          db.prepare('UPDATE books SET stock_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(correctStock, b.id);
          rebuildBookIndex(b.id);
        }
      });
    })();
    console.log('Database stock quantities synchronized successfully.');
  } catch (err) {
    console.error('Error synchronizing database stocks:', err.message);
  }
}
syncBookStocks();

app.listen(PORT, () => console.log(`Bookstore MVP running: http://localhost:${PORT}`));


