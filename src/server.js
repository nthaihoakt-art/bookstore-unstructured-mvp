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
const { db, audit, upsertName, rebuildBookIndex, rebuildDocumentIndex, setDocumentMetadata } = require('./db');
const XLSX = require('xlsx');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production.');
}
const PORT = Number(process.env.PORT || 4000);
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'bookstore-unstructured-mvp' }));
app.use(express.json({ limit: '2mb' }));
// KhÃ´ng expose upload directory tÄ©nh; preview/download pháº£i Ä‘i qua API cÃ³ auth.
app.use(express.static(path.join(__dirname, '..', 'public')));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname)}`)
});
const allowed = new Set(['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_, file, cb) => cb(allowed.has(file.mimetype) ? null : new Error('Loáº¡i file khÃ´ng Ä‘Æ°á»£c há»— trá»£'), allowed.has(file.mimetype)) });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try { req.user = enrichUser(jwt.verify(token, JWT_SECRET)); next(); } catch { res.status(401).json({ error: 'Token không hợp lệ' }); }
}
function requireRole(...roles) { return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này.' }); }
function all(sql, params=[]) { return db.prepare(sql).all(...params); }
function get(sql, params=[]) { return db.prepare(sql).get(...params); }
function userPermissions(userId) {
  return all(`SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id JOIN users u ON u.role_id=rp.role_id WHERE u.id=?`, [userId]).map(p => p.code);
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
  if (!textLike && !docxLike && !exact) throw new Error('File khÃ´ng khá»›p Ä‘á»‹nh dáº¡ng khai bÃ¡o');
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
  if (!user || !bcrypt.compareSync(body.password, user.password_hash)) return res.status(401).json({ error: 'Sai email hoáº·c máº­t kháº©u' });
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

  const author_id = s.author ? get('SELECT id FROM authors WHERE name=?', [s.author])?.id : null;
  const duplicate = author_id 
    ? get('SELECT id FROM books WHERE title=? AND author_id=?', [s.title, author_id])
    : get('SELECT id FROM books WHERE title=? AND author_id IS NULL', [s.title]);
  if (duplicate) {
    return res.status(400).json({ error: 'Sách có cùng tên và tác giả này đã tồn tại trong hệ thống.' });
  }

  const info = db.prepare(`INSERT INTO books(code,title,author_id,category_id,publisher_id,isbn,published_year,pages,language,import_price,sale_price,stock_quantity,description,excerpt,tags)
    VALUES (@code,@title,@author_id,@category_id,@publisher_id,@isbn,@published_year,@pages,@language,@import_price,@sale_price,@stock_quantity,@description,@excerpt,@tags)`).run({
      code: s.code,
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
  rebuildBookIndex(info.lastInsertRowid); audit(req.user.id,'create','book',info.lastInsertRowid,s); res.status(201).json(get('SELECT * FROM books WHERE id=?',[info.lastInsertRowid]));
});
app.get('/api/books/:id', auth, requirePermission('books.view'), (req, res) => {
  const book = get(`SELECT b.*, a.name author, c.name category, p.name publisher FROM books b LEFT JOIN authors a ON a.id=b.author_id LEFT JOIN categories c ON c.id=b.category_id LEFT JOIN publishers p ON p.id=b.publisher_id WHERE b.id=?`, [req.params.id]);
  if (!book) return res.status(404).json({ error:'KhÃ´ng tÃ¬m tháº¥y sÃ¡ch' });
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

  db.prepare(`UPDATE books SET code=?,title=?,author_id=?,category_id=?,publisher_id=?,isbn=?,published_year=?,pages=?,language=?,import_price=?,sale_price=?,stock_quantity=?,description=?,excerpt=?,tags=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(s.code,s.title,author_id,s.category?upsertName('categories',s.category):old.category_id,s.publisher?upsertName('publishers',s.publisher):old.publisher_id,s.isbn,s.published_year,s.pages,s.language,s.import_price,s.sale_price,s.stock_quantity,s.description,s.excerpt,JSON.stringify(s.tags||[]),req.params.id);
  rebuildBookIndex(req.params.id); audit(req.user.id,'update','book',req.params.id,req.body); res.json(get('SELECT * FROM books WHERE id=?',[req.params.id]));
});
app.delete('/api/books/:id', auth, requirePermission('books.delete'), (req, res) => { db.prepare('DELETE FROM search_index WHERE entity_type=? AND entity_id=?').run('book', req.params.id); db.prepare('DELETE FROM books WHERE id=?').run(req.params.id); audit(req.user.id,'delete','book',req.params.id); res.json({ ok:true }); });
app.get('/api/categories', auth, (req, res) => res.json(all('SELECT * FROM categories ORDER BY name')));

app.get('/api/customers', auth, requirePermission('customers.view'), (req,res)=>{ const q=`%${req.query.q||''}%`; if(ownOnly(req,'customers.view_all')) return res.json(all('SELECT * FROM customers WHERE created_by=? AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ?) ORDER BY id DESC',[req.user.id,q,q,q,q])); res.json(all('SELECT * FROM customers WHERE full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ? ORDER BY id DESC',[q,q,q,q])); });
app.post('/api/customers', auth, requirePermission('customers.create'), (req,res)=>{ const s=z.object({full_name:z.string(),phone:z.string().optional(),email:z.string().optional(),type:z.string().default('retail'),notes:z.string().optional()}).parse(req.body); const r=db.prepare('INSERT INTO customers(full_name,phone,email,type,notes,created_by) VALUES (@full_name,@phone,@email,@type,@notes,@created_by)').run({ full_name: s.full_name, phone: s.phone ?? null, email: s.email ?? null, type: s.type, notes: s.notes ?? null, created_by: req.user.id }); audit(req.user.id,'create','customer',r.lastInsertRowid,s); res.status(201).json(get('SELECT * FROM customers WHERE id=?',[r.lastInsertRowid])); });
app.get('/api/customers/:id', auth, requirePermission('customers.view'), (req,res)=>{ const c=get('SELECT * FROM customers WHERE id=?',[req.params.id]); if(!c) return res.status(404).json({error:'Không tìm thấy khách hàng'}); if(ownOnly(req,'customers.view_all') && c.created_by !== req.user.id) return denyScoped(res); c.orders=all('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC',[c.id]); c.reviews=all('SELECT r.*, b.title book_title FROM reviews r LEFT JOIN books b ON b.id=r.book_id WHERE r.customer_id=? ORDER BY r.created_at DESC',[c.id]); c.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['customer',c.id]); res.json(c); });
app.put('/api/customers/:id', auth, requirePermission('customers.update'), (req,res)=>{ const old=get('SELECT * FROM customers WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y khÃ¡ch hÃ ng'}); const s={...old,...req.body}; db.prepare('UPDATE customers SET full_name=?,phone=?,email=?,type=?,notes=? WHERE id=?').run(s.full_name,s.phone,s.email,s.type,s.notes,req.params.id); audit(req.user.id,'update','customer',req.params.id,req.body); res.json(get('SELECT * FROM customers WHERE id=?',[req.params.id])); });
app.delete('/api/customers/:id', auth, requirePermission('customers.delete'), (req,res)=>{ db.prepare('DELETE FROM customers WHERE id=?').run(req.params.id); audit(req.user.id,'delete','customer',req.params.id); res.json({ok:true}); });

app.get('/api/suppliers', auth, requirePermission('suppliers.view'), (req,res)=>{ const q=`%${req.query.q||''}%`; res.json(all('SELECT * FROM suppliers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ? ORDER BY id DESC',[q,q,q,q])); });
app.post('/api/suppliers', auth, requirePermission('suppliers.create'), (req,res)=>{ const s=req.body; const r=db.prepare('INSERT INTO suppliers(name,contact_name,phone,email,address,notes,rating) VALUES (@name,@contact_name,@phone,@email,@address,@notes,@rating)').run({ name: s.name, contact_name: s.contact_name ?? null, phone: s.phone ?? null, email: s.email ?? null, address: s.address ?? null, notes: s.notes ?? null, rating: s.rating ?? 3 }); audit(req.user.id,'create','supplier',r.lastInsertRowid,s); res.status(201).json(get('SELECT * FROM suppliers WHERE id=?',[r.lastInsertRowid])); });
app.get('/api/suppliers/:id', auth, requirePermission('suppliers.view'), (req,res)=>{ const s=get('SELECT * FROM suppliers WHERE id=?',[req.params.id]); if(!s) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y nhÃ  cung cáº¥p'}); s.inventory=all('SELECT it.*, b.title book_title FROM inventory_transactions it JOIN books b ON b.id=it.book_id WHERE it.supplier_id=? ORDER BY it.created_at DESC',[s.id]); s.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['supplier',s.id]); res.json(s); });
app.put('/api/suppliers/:id', auth, requirePermission('suppliers.update'), (req,res)=>{ const old=get('SELECT * FROM suppliers WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y nhÃ  cung cáº¥p'}); const s={...old,...req.body}; db.prepare('UPDATE suppliers SET name=?,contact_name=?,phone=?,email=?,address=?,notes=?,rating=? WHERE id=?').run(s.name,s.contact_name,s.phone,s.email,s.address,s.notes,s.rating,req.params.id); audit(req.user.id,'update','supplier',req.params.id,req.body); res.json(get('SELECT * FROM suppliers WHERE id=?',[req.params.id])); });
app.delete('/api/suppliers/:id', auth, requirePermission('suppliers.delete'), (req,res)=>{ db.prepare('DELETE FROM suppliers WHERE id=?').run(req.params.id); audit(req.user.id,'delete','supplier',req.params.id); res.json({ok:true}); });

app.get('/api/orders', auth, requirePermission('orders.view'), (req,res)=>{ const where=ownOnly(req,'orders.view_all')?'WHERE o.created_by=?':''; const params=where?[req.user.id]:[]; res.json(all(`SELECT o.*, c.full_name customer_name, u.full_name created_by_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.created_by ${where} ORDER BY o.created_at DESC`,params)); });
app.get('/api/orders/:id', auth, requirePermission('orders.view'), (req,res)=>{ if(!/^\d+$/.test(String(req.params.id))) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); const o=get(`SELECT o.*, c.full_name customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`,[req.params.id]); if(!o) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && o.created_by !== req.user.id) return denyScoped(res); o.items=all('SELECT oi.*, b.title book_title, b.code book_code FROM order_items oi JOIN books b ON b.id=oi.book_id WHERE oi.order_id=?',[o.id]); o.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['order',o.id]); res.json(o); });
app.post('/api/orders', auth, requirePermission('orders.create'), (req,res)=>{
  const s=z.object({customer_id:z.number().optional(), payment_method:z.string().default('cash'), discount:z.number().default(0), tax:z.number().default(0), notes:z.string().optional(), items:z.array(z.object({book_id:z.number(),quantity:z.number().int().positive()})).min(1)}).parse(req.body);
  const tx=db.transaction(()=>{ let subtotal=0; const priced=s.items.map(i=>{ const b=get('SELECT id,title,sale_price,stock_quantity FROM books WHERE id=?',[i.book_id]); if(!b) throw new Error('SÃ¡ch khÃ´ng tá»“n táº¡i'); if(b.stock_quantity<i.quantity) throw new Error(`KhÃ´ng Ä‘á»§ tá»“n kho: ${b.title}`); const total=b.sale_price*i.quantity; subtotal+=total; return {...i, unit_price:b.sale_price,total}; }); const total=subtotal-s.discount+s.tax; const code=`ORD-${Date.now()}`; const r=db.prepare('INSERT INTO orders(order_code,customer_id,payment_method,subtotal,discount,tax,total,notes,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)').run(code,s.customer_id||null,s.payment_method,subtotal,s.discount,s.tax,total,s.notes||null,'paid',req.user.id); priced.forEach(i=>{ db.prepare('INSERT INTO order_items(order_id,book_id,quantity,unit_price,total) VALUES (?,?,?,?,?)').run(r.lastInsertRowid,i.book_id,i.quantity,i.unit_price,i.total); db.prepare('UPDATE books SET stock_quantity=stock_quantity-?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(i.quantity,i.book_id); db.prepare('INSERT INTO inventory_transactions(book_id,type,quantity,note,created_by) VALUES (?,?,?,?,?)').run(i.book_id,'sale',-i.quantity,code,req.user.id); rebuildBookIndex(i.book_id); }); audit(req.user.id,'create','order',r.lastInsertRowid,s); return get('SELECT * FROM orders WHERE id=?',[r.lastInsertRowid]); });
  try { res.status(201).json(tx()); } catch(e) { res.status(400).json({error:e.message}); }
});
app.put('/api/orders/:id/status', auth, requirePermission('orders.update'), (req,res)=>{ const s=z.object({status:z.enum(['new','paid','shipping','completed','cancelled']), notes:z.string().optional()}).parse(req.body); const old=get('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && old.created_by !== req.user.id) return denyScoped(res); db.prepare('UPDATE orders SET status=?, notes=COALESCE(?, notes) WHERE id=?').run(s.status,s.notes,req.params.id); audit(req.user.id,'update_status','order',req.params.id,s); res.json(get('SELECT * FROM orders WHERE id=?',[req.params.id])); });
app.post('/api/orders/:id/cancel', auth, requirePermission('orders.cancel'), (req,res)=>{ const old=get('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && old.created_by !== req.user.id) return denyScoped(res); if(old.status==='cancelled') return res.status(400).json({error:'ÄÆ¡n hÃ ng Ä‘Ã£ há»§y'}); const reason=req.body?.reason||'Há»§y Ä‘Æ¡n vÃ  hoÃ n tá»“n kho'; const tx=db.transaction(()=>{ const items=all('SELECT * FROM order_items WHERE order_id=?',[old.id]); items.forEach(i=>{ db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(i.quantity,i.book_id); db.prepare('INSERT INTO inventory_transactions(book_id,type,quantity,note,created_by) VALUES (?,?,?,?,?)').run(i.book_id,'return',i.quantity,`${old.order_code} - ${reason}`,req.user.id); rebuildBookIndex(i.book_id); }); db.prepare('UPDATE orders SET status=?, notes=COALESCE(notes,\'\') || ? WHERE id=?').run('cancelled',`\n[CANCEL] ${reason}`,old.id); audit(req.user.id,'cancel','order',old.id,{reason, restoredItems:items.length}); return get('SELECT * FROM orders WHERE id=?',[old.id]); }); try{res.json(tx())}catch(e){res.status(400).json({error:e.message})} });
app.delete('/api/orders/:id', auth, requirePermission('orders.cancel'), (req,res)=>{ const old=get('SELECT * FROM orders WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'Không tìm thấy đơn hàng'}); if(ownOnly(req,'orders.view_all') && old.created_by !== req.user.id) return denyScoped(res); db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id); audit(req.user.id,'delete','order',req.params.id); res.json({ok:true}); });

app.get('/api/inventory', auth, requirePermission('inventory.view'), (req,res)=>res.json(all(`SELECT b.id book_id,b.code,b.title,b.stock_quantity,b.import_price,b.sale_price,c.name category FROM books b LEFT JOIN categories c ON c.id=b.category_id ORDER BY b.stock_quantity ASC`)));
app.get('/api/inventory/slips', auth, requirePermission('inventory.view'), (req,res)=>res.json(all(`SELECT sl.*, s.name supplier_name, u.full_name created_by_name, COUNT(it.id) item_count, COALESCE(SUM(ABS(it.quantity) * it.unit_cost),0) total_cost FROM inventory_slips sl LEFT JOIN suppliers s ON s.id=sl.supplier_id LEFT JOIN users u ON u.id=sl.created_by LEFT JOIN inventory_transactions it ON it.slip_id=sl.id GROUP BY sl.id ORDER BY sl.created_at DESC LIMIT 200`)));
app.get('/api/inventory/slips/:id', auth, requirePermission('inventory.view'), (req,res)=>{ if(!/^\d+$/.test(String(req.params.id))) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y phiáº¿u kho'}); const sl=get(`SELECT sl.*, s.name supplier_name, u.full_name created_by_name FROM inventory_slips sl LEFT JOIN suppliers s ON s.id=sl.supplier_id LEFT JOIN users u ON u.id=sl.created_by WHERE sl.id=?`,[req.params.id]); if(!sl) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y phiáº¿u kho'}); sl.items=all(`SELECT it.*, b.code book_code, b.title book_title FROM inventory_transactions it JOIN books b ON b.id=it.book_id WHERE it.slip_id=?`,[sl.id]); sl.documents=all('SELECT id, original_name, doc_type, title, created_at FROM documents WHERE entity_type=? AND entity_id=?',['inventory_slip',sl.id]); res.json(sl); });
app.post('/api/inventory/slips', auth, requirePermission('inventory.import','inventory.export','inventory.adjust'), (req,res)=>{ const s=z.object({type:z.enum(['in','out','adjust']),supplier_id:z.number().optional(),note:z.string().optional(),items:z.array(z.object({book_id:z.number(),quantity:z.number().int(),unit_cost:z.number().default(0)})).min(1)}).parse(req.body); const tx=db.transaction(()=>{ const code=`SLIP-${s.type.toUpperCase()}-${Date.now()}`; const sr=db.prepare('INSERT INTO inventory_slips(slip_code,type,supplier_id,note,created_by) VALUES (?,?,?,?,?)').run(code,s.type,s.supplier_id||null,s.note||null,req.user.id); s.items.forEach(item=>{ const delta=s.type==='in'?Math.abs(item.quantity):s.type==='out'?-Math.abs(item.quantity):item.quantity; const b=get('SELECT id,title,stock_quantity FROM books WHERE id=?',[item.book_id]); if(!b) throw new Error('SÃ¡ch khÃ´ng tá»“n táº¡i'); if(s.type==='out' && b.stock_quantity < Math.abs(item.quantity)) throw new Error(`KhÃ´ng Ä‘á»§ tá»“n kho: ${b.title}`); db.prepare('INSERT INTO inventory_transactions(slip_id,book_id,supplier_id,type,quantity,unit_cost,note,created_by) VALUES (?,?,?,?,?,?,?,?)').run(sr.lastInsertRowid,item.book_id,s.supplier_id||null,s.type,delta,item.unit_cost,s.note||code,req.user.id); db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, import_price=CASE WHEN ? > 0 THEN ? ELSE import_price END, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(delta,item.unit_cost,item.unit_cost,item.book_id); rebuildBookIndex(item.book_id); }); audit(req.user.id,'create','inventory_slip',sr.lastInsertRowid,s); return get('SELECT * FROM inventory_slips WHERE id=?',[sr.lastInsertRowid]); }); try{res.status(201).json(tx())}catch(e){res.status(400).json({error:e.message})} });
app.post('/api/inventory/slips/:id/cancel', auth, requirePermission('inventory.adjust'), (req,res)=>{ const sl=get('SELECT * FROM inventory_slips WHERE id=?',[req.params.id]); if(!sl) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y phiáº¿u kho'}); if(sl.status==='cancelled') return res.status(400).json({error:'Phiáº¿u kho Ä‘Ã£ há»§y'}); const reason=req.body?.reason||'Há»§y phiáº¿u kho vÃ  Ä‘áº£o tá»“n'; const tx=db.transaction(()=>{ const items=all('SELECT * FROM inventory_transactions WHERE slip_id=?',[sl.id]); items.forEach(i=>{ const reverse=-i.quantity; const b=get('SELECT id,title,stock_quantity FROM books WHERE id=?',[i.book_id]); if(!b) throw new Error('SÃ¡ch khÃ´ng tá»“n táº¡i'); if(reverse<0 && b.stock_quantity < Math.abs(reverse)) throw new Error(`KhÃ´ng Ä‘á»§ tá»“n kho Ä‘á»ƒ há»§y phiáº¿u: ${b.title}`); db.prepare('UPDATE books SET stock_quantity=stock_quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(reverse,i.book_id); db.prepare('INSERT INTO inventory_transactions(book_id,supplier_id,type,quantity,unit_cost,note,created_by) VALUES (?,?,?,?,?,?,?)').run(i.book_id,i.supplier_id,'reverse',reverse,i.unit_cost,`${sl.slip_code} - ${reason}`,req.user.id); rebuildBookIndex(i.book_id); }); db.prepare("UPDATE inventory_slips SET status='cancelled', cancelled_at=CURRENT_TIMESTAMP, cancelled_by=? WHERE id=?").run(req.user.id,sl.id); audit(req.user.id,'cancel','inventory_slip',sl.id,{reason,reversedItems:items.length}); return get('SELECT * FROM inventory_slips WHERE id=?',[sl.id]); }); try{res.json(tx())}catch(e){res.status(400).json({error:e.message})} });
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
  const topBooks = all(`SELECT b.title, SUM(oi.quantity) qty, SUM(oi.total) revenue FROM order_items oi JOIN books b ON b.id=oi.book_id GROUP BY b.id ORDER BY qty DESC LIMIT 10`);
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
app.put('/api/roles/:id/permissions', auth, requirePermission('roles.manage'), (req,res)=>{ const role=get('SELECT * FROM roles WHERE id=?',[req.params.id]); if(!role) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y role'}); const ids=z.object({permission_ids:z.array(z.number())}).parse(req.body).permission_ids; const tx=db.transaction(()=>{ db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(role.id); const ins=db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES (?,?)'); ids.forEach(pid=>ins.run(role.id,pid)); audit(req.user.id,'update_permissions','role',role.id,{permission_ids:ids}); return all(`SELECT p.* FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=? ORDER BY p.code`,[role.id]); }); res.json({role,permissions:tx()}); });
app.get('/api/users', auth, requirePermission('users.view'), (req,res)=>res.json(all(`SELECT u.id,u.full_name,u.email,u.is_active,u.created_at,r.name role,r.id role_id FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id`)));
app.post('/api/users', auth, requirePermission('users.create'), (req,res)=>{ const s=z.object({full_name:z.string().min(1),email:z.string().email(),password:z.string().min(6),role_id:z.number(),is_active:z.number().optional()}).parse(req.body); const r=db.prepare('INSERT INTO users(full_name,email,password_hash,role_id,is_active) VALUES (?,?,?,?,?)').run(s.full_name,s.email,bcrypt.hashSync(s.password,10),s.role_id,s.is_active ?? 1); audit(req.user.id,'create','user',r.lastInsertRowid,{email:s.email,role_id:s.role_id}); res.status(201).json(get('SELECT id,full_name,email,role_id,is_active,created_at FROM users WHERE id=?',[r.lastInsertRowid])); });
app.put('/api/users/:id', auth, requirePermission('users.update'), (req,res)=>{ const old=get('SELECT * FROM users WHERE id=?',[req.params.id]); if(!old) return res.status(404).json({error:'KhÃ´ng tÃ¬m tháº¥y user'}); const s={...old,...req.body}; const passwordHash=req.body.password?bcrypt.hashSync(req.body.password,10):old.password_hash; db.prepare('UPDATE users SET full_name=?,email=?,password_hash=?,role_id=?,is_active=? WHERE id=?').run(s.full_name,s.email,passwordHash,s.role_id,s.is_active?1:0,req.params.id); audit(req.user.id,'update','user',req.params.id,{email:s.email,role_id:s.role_id,is_active:s.is_active}); res.json(get('SELECT id,full_name,email,role_id,is_active,created_at FROM users WHERE id=?',[req.params.id])); });
app.delete('/api/users/:id', auth, requirePermission('users.delete'), (req,res)=>{ if(Number(req.params.id)===req.user.id) return res.status(400).json({error:'KhÃ´ng thá»ƒ xÃ³a chÃ­nh mÃ¬nh'}); db.prepare('UPDATE users SET is_active=0 WHERE id=?').run(req.params.id); audit(req.user.id,'deactivate','user',req.params.id); res.json({ok:true}); });
app.get('/api/audit-logs', auth, requirePermission('audit_logs.view'), (req,res)=>res.json(all(`SELECT l.*, u.full_name user_name FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 200`)));

app.use((err, req, res, next) => res.status(400).json({ error: err.message || 'Lá»—i há»‡ thá»‘ng' }));
app.listen(PORT, () => console.log(`Bookstore MVP running: http://localhost:${PORT}`));


