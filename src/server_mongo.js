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
const PDFParse = require('pdf-parse');
const mammoth = require('mammoth');
const { createWorker } = require('tesseract.js');
const XLSX = require('xlsx');
const aiService = require('./ai-service');
const { connectRedis, isRedisActive, getRedisInfo } = require('./redis-client');
const cartService = require('./cart-service');
const otpService = require('./otp-service');
const cacheService = require('./cache-service');

// Override DNS for MongoDB Atlas SRV lookup issues
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}

const mongoose = require('mongoose');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production.');
}
const PORT = Number(process.env.PORT || 4000);
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'bookstore-unstructured-mongodb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Connect MongoDB Atlas
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://nnp1426_db_user:SjipRoD5Q4CDpEiU@cluster0.1ovaxuk.mongodb.net/bookstore_migrated?appName=Cluster0';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB Atlas: ' + MONGO_URI.split('@')[1] || MONGO_URI))
  .catch(err => console.error('MongoDB connection error:', err));

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname)}`)
});
const allowed = new Set(['image/png','image/jpeg','image/webp','application/pdf','text/plain','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (_, file, cb) => cb(allowed.has(file.mimetype) ? null : new Error('Loại file không được hỗ trợ'), allowed.has(file.mimetype)) });
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// -------------------------------------------------------------
// DEFINE MONGOOSE SCHEMAS & MODELS
// -------------------------------------------------------------
const roleSchema = new mongoose.Schema({
  _id: Number,
  name: { type: String, unique: true, required: true },
  description: String,
  permissions: [String]
});
const Role = mongoose.model('Role', roleSchema);

const userSchema = new mongoose.Schema({
  _id: Number,
  fullName: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, required: true },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const bookSchema = new mongoose.Schema({
  _id: Number,
  code: { type: String, unique: true, required: true },
  title: { type: String, required: true },
  author: String,
  category: String,
  publisher: String,
  isbn: String,
  publishedYear: Number,
  pages: Number,
  language: { type: String, default: 'vi' },
  importPrice: { type: Number, default: 0 },
  salePrice: { type: Number, required: true },
  stockQuantity: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  coverDocumentId: Number,
  description: String,
  excerpt: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
bookSchema.index({
  title: 'text',
  code: 'text',
  author: 'text',
  category: 'text',
  publisher: 'text',
  isbn: 'text',
  description: 'text'
}, { language_override: 'none' });
const Book = mongoose.model('Book', bookSchema);

const customerSchema = new mongoose.Schema({
  _id: Number,
  fullName: { type: String, required: true },
  phone: String,
  email: String,
  passwordHash: String,
  type: { type: String, default: 'retail' },
  notes: String,
  isActive: { type: Boolean, default: true },
  createdBy: Number,
  createdAt: { type: Date, default: Date.now }
});
const Customer = mongoose.model('Customer', customerSchema);

const supplierSchema = new mongoose.Schema({
  _id: Number,
  name: { type: String, required: true },
  contactName: String,
  phone: String,
  email: String,
  address: String,
  notes: String,
  rating: { type: Number, default: 3 },
  createdAt: { type: Date, default: Date.now }
});
const Supplier = mongoose.model('Supplier', supplierSchema);

const orderSchema = new mongoose.Schema({
  _id: Number,
  orderCode: { type: String, unique: true, required: true },
  customerId: Number,
  customerName: String,
  status: { type: String, default: 'paid' },
  paymentMethod: { type: String, default: 'cash' },
  subtotal: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  notes: String,
  createdBy: Number,
  items: [{
    bookId: Number,
    bookCode: String,
    bookTitle: String,
    quantity: Number,
    unitPrice: Number,
    total: Number
  }],
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const inventorySlipSchema = new mongoose.Schema({
  _id: Number,
  slipCode: { type: String, unique: true, required: true },
  type: { type: String, enum: ['in', 'out', 'adjust'], required: true },
  supplierId: Number,
  note: String,
  status: { type: String, default: 'active' },
  createdBy: Number,
  cancelledAt: Date,
  cancelledBy: Number,
  items: [{
    bookId: Number,
    bookCode: String,
    bookTitle: String,
    quantity: Number,
    unitCost: Number,
    note: String
  }],
  createdAt: { type: Date, default: Date.now }
});
const InventorySlip = mongoose.model('InventorySlip', inventorySlipSchema);

const documentSchema = new mongoose.Schema({
  _id: Number,
  originalName: { type: String, required: true },
  storedName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  checksum: String,
  docType: { type: String, default: 'internal' },
  entityType: String,
  entityId: Number,
  title: String,
  notes: String,
  isImportant: { type: Boolean, default: false },
  extractedText: String,
  ocrStatus: { type: String, default: 'not_required' },
  processingError: String,
  uploadedBy: Number,
  metadata: mongoose.Schema.Types.Map,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
documentSchema.index({
  title: 'text',
  originalName: 'text',
  notes: 'text',
  extractedText: 'text'
}, { language_override: 'none' });
const Document = mongoose.model('Document', documentSchema);

// Sync indexes asynchronously to ensure text and unique indexes are built/updated correctly

// Review schema legacy — chuyển sang Feedback, giữ Review cho tương thích ngược
const reviewSchema = new mongoose.Schema({
  _id: Number,
  bookId: Number,
  customerId: Number,
  rating: { type: Number, default: 5 },
  content: String,
  createdAt: { type: Date, default: Date.now }
});
const Review = mongoose.model('Review', reviewSchema);

const auditLogSchema = new mongoose.Schema({
  _id: Number,
  userId: Number,
  action: { type: String, required: true },
  entityType: String,
  entityId: Number,
  details: String,
  createdAt: { type: Date, default: Date.now }
});
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// SystemLog - lưu log có cấu trúc trên MongoDB thay vì file
const systemLogSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  timestamp: { type: Date, default: Date.now },
  userName: { type: String, required: true },
  action: { type: String, required: true },
  entityType: String,
  entityId: String,
  details: String,
  ipAddress: String
});
systemLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
const SystemLog = mongoose.model('SystemLog', systemLogSchema);

const reportSchema = new mongoose.Schema({
  _id: Number,
  title: { type: String, required: true },
  fileName: { type: String, required: true },
  fileType: { type: String, enum: ['csv', 'xlsx', 'pdf', 'txt'], required: true },
  fileSizeKB: Number,
  fileData: { type: Buffer, required: true },
  uploadedBy: { type: String, required: true },
  notes: String,
  createdAt: { type: Date, default: Date.now }
});
reportSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });
const Report = mongoose.model('Report', reportSchema);

const feedbackSchema = new mongoose.Schema({
  _id: Number,
  bookId: Number,
  customerId: Number,
  customerName: { type: String, required: true },
  email: String,
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  tags: [String],
  media: [{
    fileName: String,
    fileType: String,
    fileSizeKB: Number,
    fileData: Buffer
  }],
  sentiment: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
  score: { type: Number, default: 0.5 },
  isFeatured: { type: Boolean, default: false },
  status: { type: String, enum: ['new', 'reviewed', 'resolved', 'urgent'], default: 'new' },
  createdAt: { type: Date, default: Date.now }
});
feedbackSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });
feedbackSchema.index({ bookId: 1, createdAt: -1 });
feedbackSchema.index({ sentiment: 1, rating: -1 });
feedbackSchema.index({ isFeatured: -1, createdAt: -1 });
const Feedback = mongoose.model('Feedback', feedbackSchema);

// BookRecommendation schema (MỚI — NoSQL MongoDB collection #2 bổ sung)
const bookRecommendationSchema = new mongoose.Schema({
  bookId: { type: Number, required: true, unique: true },
  bookTitle: String,
  similarBooks: [{
    bookId: Number,
    bookTitle: String,
    score: Number,
    reason: String,
  }],
  frequentlyBoughtTogether: [Number],
  updatedAt: { type: Date, default: Date.now },
});
bookRecommendationSchema.index({ updatedAt: -1 });
const BookRecommendation = mongoose.model('BookRecommendation', bookRecommendationSchema);

// Sync indexes asynchronously to ensure text, unique, and TTL indexes are built/updated correctly
Promise.all([
  Book.syncIndexes(),
  Document.syncIndexes(),
  AuditLog.syncIndexes(),
  Report.syncIndexes(),
  Feedback.syncIndexes()
])
  .then(() => console.log('Database indexes synchronized.'))
  .catch(err => console.error('Error synchronizing indexes:', err));

async function getNextId(Model, session = null) {
  let query = Model.findOne({}).sort({ _id: -1 });
  if (session) {
    query = query.session(session);
  }
  const lastDoc = await query.exec();
  return lastDoc && typeof lastDoc._id === 'number' ? lastDoc._id + 1 : 1;
}

// -------------------------------------------------------------
// HELPER MIDDLEWARES & FUNCTIONS
// -------------------------------------------------------------
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

async function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const verified = jwt.verify(token, JWT_SECRET);
    const userObj = await User.findById(verified.id);
    if (!userObj || !userObj.isActive) return res.status(401).json({ error: 'Tài khoản không hợp lệ' });
    
    // Enrich with permissions list
    const roleObj = await Role.findOne({ name: userObj.role });
    const codes = roleObj ? roleObj.permissions : [];
    const expanded = new Set(codes);
    for (const [detailed, coarse] of Object.entries(PERMISSION_MAP)) {
      if (codes.includes(coarse)) {
        expanded.add(detailed);
      }
    }

    req.user = {
      id: userObj._id,
      email: userObj.email,
      fullName: userObj.fullName,
      role: userObj.role,
      permissions: Array.from(expanded)
    };
    next();
  } catch(e) {
    res.status(401).json({ error: 'Token không hợp lệ' });
  }
}

function requirePermission(...required) {
  return (req, res, next) => {
    if (required.some(p => req.user.permissions.includes(p))) return next();
    return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này.' });
  };
}

function ownOnly(req, allPermission) {
  return !req.user.permissions.includes(allPermission);
}

function denyScoped(res) {
  return res.status(403).json({ error: 'Bạn không có quyền truy cập dữ liệu này.' });
}

async function audit(userId, action, entityType, entityId, details = {}) {
  try {
    const log = new AuditLog({
      _id: await getNextId(AuditLog),
      userId: userId || null,
      action,
      entityType,
      entityId: entityId || null,
      details: JSON.stringify(details)
    });
    await log.save();
  } catch(e) {
    console.error('Lỗi lưu audit log:', e);
  }
}

function parseMetadata(body) {
  try { return body.metadata_json ? JSON.parse(body.metadata_json) : {}; } catch { return {}; }
}

async function sniffMime(filePath) {
  const { fileTypeFromFile } = await import('file-type');
  return fileTypeFromFile(filePath);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function validateUploadFile(file) {
  const detected = await sniffMime(file.path);
  const ext = path.extname(file.originalname).toLowerCase();
  const textLike = file.mimetype === 'text/plain' && (!detected || ext === '.txt');
  const docxLike = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && detected?.mime === 'application/zip' && ext === '.docx';
  const exact = detected && detected.mime === file.mimetype;
  if (!textLike && !docxLike && !exact) throw new Error('File không khớp định dạng khai báo');
}

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
      if (matches) matchesCount += matches.length;
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
  try {
    const result = await worker.recognize(file.path);
    return (result.data.text || '').slice(0, 200000);
  } finally {
    await worker.terminate();
  }
}

async function extractText(file) {
  try {
    if (file.mimetype === 'text/plain') return { text: fs.readFileSync(file.path, 'utf8').slice(0, 200000), status: 'done' };
    if (file.mimetype === 'application/pdf') {
      const parser = new PDFParse({ data: fs.readFileSync(file.path) });
      const result = await parser.getText();
      await parser.destroy();
      return { text: (result.text || '').slice(0, 200000), status: 'done' };
    }
    if (file.mimetype.includes('wordprocessingml')) return { text: (await mammoth.extractRawText({ path: file.path })).value.slice(0, 200000), status: 'done' };
    if (file.mimetype.startsWith('image/')) return { text: await ocrImage(file), status: 'done' };
    return { text: '', status: 'not_required' };
  } catch (e) {
    return { text: '', status: 'failed', error: e.message };
  }
}

async function syncBookFieldsFromDocument(docId) {
  const d = await Document.findById(docId);
  if (!d) return;

  const targetBookId = (d.entityType === 'book' && d.docType === 'cover') ? d.entityId : null;
  if (targetBookId) {
    await Book.updateMany({ coverDocumentId: d._id, _id: { $ne: targetBookId } }, { coverDocumentId: null });
    await Book.findByIdAndUpdate(targetBookId, { coverDocumentId: d._id, updatedAt: new Date() });
  } else {
    await Book.updateMany({ coverDocumentId: d._id }, { coverDocumentId: null });
  }

  if (d.entityType === 'book' && d.entityId && d.docType === 'book_description') {
    const textToUse = (d.extractedText && d.extractedText.trim() !== '') ? d.extractedText : d.notes;
    if (textToUse && textToUse.trim() !== '') {
      await Book.findByIdAndUpdate(d.entityId, { description: textToUse.trim(), updatedAt: new Date() });
    }
  }
}

// Javascript helper to simulate SQLite FTS5 snippet() function in MongoDB
function makeSnippet(text, query, maxWords = 12) {
  if (!text || !query) return '';
  const words = text.split(/\s+/);
  const qLower = query.toLowerCase();
  const matchIdx = words.findIndex(w => w.toLowerCase().includes(qLower));
  
  if (matchIdx === -1) return words.slice(0, maxWords).join(' ') + '...';
  
  const start = Math.max(0, matchIdx - Math.floor(maxWords / 2));
  const end = Math.min(words.length, start + maxWords);
  
  const selected = words.slice(start, end);
  const highlighted = selected.map(w => {
    if (w.toLowerCase().includes(qLower)) {
      // Keep punctuation outside <mark> if possible, or just wrap the word
      return `<mark>${w}</mark>`;
    }
    return w;
  });
  
  return (start > 0 ? '... ' : '') + highlighted.join(' ') + (end < words.length ? ' ...' : '');
}

// -------------------------------------------------------------
// API ROUTING
// -------------------------------------------------------------

app.post('/api/auth/login', async (req, res) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await User.findOne({ email: body.email, isActive: true });
    if (!user || !bcrypt.compareSync(body.password, user.passwordHash)) {
      return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });
    }
    const roleObj = await Role.findOne({ name: user.role });
    const codes = roleObj ? roleObj.permissions : [];
    const expanded = new Set(codes);
    for (const [detailed, coarse] of Object.entries(PERMISSION_MAP)) {
      if (codes.includes(coarse)) {
        expanded.add(detailed);
      }
    }
    const permissions = Array.from(expanded);
    
    const token = jwt.sign({ id: user._id, email: user.email, fullName: user.fullName, role: user.role, permissions }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, user: { id: user._id, email: user.email, fullName: user.fullName, role: user.role, permissions } });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

app.get('/api/books', auth, requirePermission('books.view'), async (req, res) => {
  try {
    const query = req.query.q || '';
    const filter = {};
    if (query) {
      filter.$or = [
        { title: { $regex: query, $options: 'i' } },
        { code: { $regex: query, $options: 'i' } },
        { isbn: { $regex: query, $options: 'i' } },
        { author: { $regex: query, $options: 'i' } }
      ];
    }
    const list = await Book.find(filter).sort({ code: 1 });
    // Format response to match SQLite columns expected by Frontend
    const mapped = list.map(b => ({
      id: b._id,
      code: b.code,
      title: b.title,
      author: b.author || '',
      category: b.category || '',
      publisher: b.publisher || '',
      isbn: b.isbn || '',
      published_year: b.publishedYear || null,
      pages: b.pages || null,
      language: b.language,
      import_price: b.importPrice,
      sale_price: b.salePrice,
      stock_quantity: b.stockQuantity,
      is_active: b.isActive ? 1 : 0,
      cover_document_id: b.coverDocumentId || null,
      description: b.description || '',
      excerpt: b.excerpt || ''
    }));
    res.json(mapped);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/books', auth, requirePermission('books.create'), async (req, res) => {
  try {
    const s = z.object({ code:z.string().regex(/^BOOK-\d+$/, 'Mã sách phải có định dạng BOOK-xxx'), title:z.string().min(1), author:z.string().optional(), category:z.string().optional(), publisher:z.string().optional(), isbn:z.string().optional(), published_year:z.number().optional(), pages:z.number().optional(), language:z.string().optional(), import_price:z.number().default(0), sale_price:z.number().default(0), stock_quantity:z.number().int().default(0), description:z.string().optional(), excerpt:z.string().optional() }).parse(req.body);

    const duplicate = await Book.findOne({ title: s.title, author: s.author || null });
    if (duplicate) {
      return res.status(400).json({ error: 'Sách có cùng tên và tác giả này đã tồn tại.' });
    }

    const bookId = parseInt(s.code.replace('BOOK-', ''), 10);
    if (isNaN(bookId) || bookId <= 0) {
      return res.status(400).json({ error: 'Mã sách không hợp lệ' });
    }
    const code = 'BOOK-' + String(bookId).padStart(3, '0');

    const existingById = await Book.findById(bookId);
    if (existingById) {
      return res.status(400).json({ error: `Mã sách ${code} đã tồn tại.` });
    }

    const b = new Book({
      _id: bookId,
      code,
      title: s.title,
      author: s.author || null,
      category: s.category || null,
      publisher: s.publisher || null,
      isbn: s.isbn ?? null,
      publishedYear: s.published_year ?? null,
      pages: s.pages ?? null,
      language: s.language ?? 'vi',
      importPrice: s.import_price,
      salePrice: s.sale_price,
      stockQuantity: s.stock_quantity,
      description: s.description ?? null,
      excerpt: s.excerpt ?? null,
    });
    await b.save();
    
    await audit(req.user.id, 'create', 'book', b._id, s);
    res.status(201).json({ id: b._id, ...s });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/books/:id', auth, requirePermission('books.view'), async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
    
    const docs = await Document.find({ entityType: 'book', entityId: book._id }).sort({ _id: -1 });
    
    // Map response for frontend
    res.json({
      id: book._id,
      code: book.code,
      title: book.title,
      author: book.author || '',
      category: book.category || '',
      publisher: book.publisher || '',
      isbn: book.isbn || '',
      published_year: book.publishedYear || null,
      pages: book.pages || null,
      language: book.language,
      import_price: book.importPrice,
      sale_price: book.salePrice,
      stock_quantity: book.stockQuantity,
      is_active: book.isActive ? 1 : 0,
      cover_document_id: book.coverDocumentId || null,
      description: book.description || '',
      excerpt: book.excerpt || '',
      documents: docs.map(d => ({
        id: d._id,
        original_name: d.originalName,
        doc_type: d.docType,
        title: d.title || d.originalName,
        created_at: d.createdAt
      }))
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/books/:id', auth, requirePermission('books.update'), async (req, res) => {
  try {
    const b = await Book.findById(req.params.id);
    if (!b) return res.status(404).json({ error: 'Không tìm thấy sách' });
    
    const body = req.body;
    const authorVal = body.author !== undefined ? body.author : b.author;
    const titleVal = body.title !== undefined ? body.title : b.title;

    const duplicate = await Book.findOne({ title: titleVal, author: authorVal, _id: { $ne: b._id } });
    if (duplicate) return res.status(400).json({ error: 'Sách trùng tên và tác giả đã tồn tại.' });

    if (body.code !== undefined) {
      const bookId = parseInt(body.code.replace('BOOK-', ''), 10);
      if (isNaN(bookId) || bookId <= 0) {
        return res.status(400).json({ error: 'Mã sách không hợp lệ' });
      }
      const code = 'BOOK-' + String(bookId).padStart(3, '0');
      if (bookId !== b._id) {
        return res.status(400).json({ error: 'Không thể thay đổi Mã sách sang ID khác.' });
      }
      b.code = code;
    }
    b.title = titleVal;
    b.author = authorVal;
    b.category = body.category !== undefined ? body.category : b.category;
    b.publisher = body.publisher !== undefined ? body.publisher : b.publisher;
    b.isbn = body.isbn !== undefined ? body.isbn : b.isbn;
    b.publishedYear = body.published_year !== undefined ? body.published_year : b.publishedYear;
    b.pages = body.pages !== undefined ? body.pages : b.pages;
    b.language = body.language !== undefined ? body.language : b.language;
    b.importPrice = body.import_price !== undefined ? body.import_price : b.importPrice;
    b.salePrice = body.sale_price !== undefined ? body.sale_price : b.salePrice;
    b.stockQuantity = body.stock_quantity !== undefined ? body.stock_quantity : b.stockQuantity;
    b.description = body.description !== undefined ? body.description : b.description;
    b.excerpt = body.excerpt !== undefined ? body.excerpt : b.excerpt;
    b.updatedAt = new Date();
    await b.save();

    await audit(req.user.id, 'update', 'book', b._id, body);
    res.json({ id: b._id, title: b.title });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/books/:id', auth, requirePermission('books.delete'), async (req, res) => {
  try {
    const b = await Book.findByIdAndDelete(req.params.id);
    if (!b) return res.status(404).json({ error: 'Không tìm thấy sách' });
    await Book.updateMany({ coverDocumentId: b._id }, { coverDocumentId: null });
    await audit(req.user.id, 'delete', 'book', req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const list = await Book.distinct('category');
    res.json(list.filter(Boolean).map(name => ({ name })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// CUSTOMERS ROUTING (with Ownership Scope)
// -------------------------------------------------------------
app.get('/api/customers', auth, requirePermission('customers.view'), async (req, res) => {
  try {
    const q = req.query.q || '';
    const filter = {};
    if (ownOnly(req, 'customers.view_all')) filter.createdBy = req.user.id;
    if (q) {
      filter.$or = [
        { fullName: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { notes: { $regex: q, $options: 'i' } }
      ];
    }
    const list = await Customer.find(filter).sort({ _id: -1 });
    res.json(list.map(c => ({
      id: c._id,
      full_name: c.fullName,
      phone: c.phone || '',
      email: c.email || '',
      type: c.type,
      notes: c.notes || '',
      created_by: c.createdBy
    })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/customers', auth, requirePermission('customers.create'), async (req, res) => {
  try {
    const s = z.object({ id: z.union([z.number(), z.string()]).optional(), full_name: z.string(), phone: z.string().optional(), email: z.string().optional(), type: z.string().default('retail'), notes: z.string().optional() }).parse(req.body);
    const newId = s.id ? Number(s.id) : await getNextId(Customer);
    if (s.id && await Customer.findById(newId)) return res.status(400).json({ error: 'ID kh?ch h?ng ?? t?n t?i' });
    const c = new Customer({
      _id: newId,
      fullName: s.full_name,
      phone: s.phone ?? null,
      email: s.email ?? null,
      type: s.type,
      notes: s.notes ?? null,
      createdBy: req.user.id
    });
    await c.save();
    await audit(req.user.id, 'create', 'customer', c._id, s);
    res.status(201).json({ id: c._id, full_name: c.fullName });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/customers/segments', auth, requirePermission('customers.view'), async (req, res) => {
  try {
    const customers = await Customer.find({});
    const orders = await Order.find({});
    
    const rows = [];
    for (const c of customers) {
      const customerOrders = orders.filter(o => o.customerId && o.customerId.toString() === c._id.toString());
      const totalSpent = customerOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const orderCount = customerOrders.length;
      rows.push({
        id: c._id.toString(),
        full_name: c.fullName,
        type: c.type,
        total_spent: totalSpent,
        order_count: orderCount
      });
    }

    const segmentNames = ['VIP', 'Khách thân thiết', 'Khách vãng lai', 'Học sinh / Sinh viên'];
    const summary = {};
    segmentNames.forEach(seg => {
      summary[seg] = { count: 0, total_spent: 0, total_orders: 0, customers: [] };
    });

    if (rows.length < 4) {
      const emptySegments = rows.map(r => ({ ...r, segment: 'Chưa đủ dữ liệu' }));
      return res.json({ segments: emptySegments, summary });
    }

    const rawData = rows.map(r => [r.total_spent, r.order_count]);
    const segmentation = require('./customer-segmentation');
    const result = segmentation.kmeans(rawData, 4);
    
    const k = result.centroids.length;
    const clusterStats = [];
    for (let j = 0; j < k; j++) {
      const members = rawData.filter((_, i) => result.labels[i] === j);
      if (members.length === 0) { clusterStats.push({ totalSpent: 0, orderCount: 0, count: 0 }); continue; }
      const avgSpent = members.reduce((s, r) => s + r[0], 0) / members.length;
      const avgOrders = members.reduce((s, r) => s + r[1], 0) / members.length;
      clusterStats.push({ totalSpent: avgSpent, orderCount: avgOrders, count: members.length });
    }

    const scores = clusterStats.map(s => ({
      ...s,
      score: (s.totalSpent || 0) * 0.7 + (s.orderCount || 0) * 0.3
    }));

    const ranked = scores.map((s, i) => ({ ...s, clusterId: i })).sort((a, b) => b.score - a.score);
    const clusterToLabel = {};
    ranked.forEach((s, rank) => {
      clusterToLabel[s.clusterId] = segmentNames[Math.min(rank, segmentNames.length - 1)];
    });

    const segments = rows.map((r, i) => ({
      ...r,
      segment: clusterToLabel[result.labels[i]] || 'Không xác định',
      cluster_id: result.labels[i]
    }));

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

app.get('/api/customers/:id', auth, requirePermission('customers.view'), async (req, res) => {
  try {
    const c = await Customer.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    if (ownOnly(req, 'customers.view_all') && String(c.createdBy) !== String(req.user.id)) return denyScoped(res);
    
    const orders = await Order.find({ customerId: c._id }).sort({ createdAt: -1 });
    const feedbacks = await Feedback.find({ customerId: c._id }).sort({ createdAt: -1 });
    const docs = await Document.find({ entityType: 'customer', entityId: c._id }).sort({ _id: -1 });
    
    // Map feedbacks with book title
    const mappedFeedbacks = [];
    for (const f of feedbacks) {
      const b = await Book.findById(f.bookId);
      mappedFeedbacks.push({
        id: f._id,
        rating: f.rating,
        comment: f.comment,
        sentiment: f.sentiment,
        isFeatured: f.isFeatured,
        status: f.status,
        created_at: f.createdAt,
        book_title: b ? b.title : 'Sách không rõ'
      });
    }

    res.json({
      id: c._id,
      full_name: c.fullName,
      phone: c.phone || '',
      email: c.email || '',
      type: c.type,
      notes: c.notes || '',
      created_by: c.createdBy,
      orders: orders.map(o => ({ id: o._id, order_code: o.orderCode, total: o.total, status: o.status, created_at: o.createdAt })),
      feedbacks: mappedFeedbacks,
      documents: docs.map(d => ({ id: d._id, original_name: d.originalName, doc_type: d.docType, title: d.title || d.originalName, created_at: d.createdAt }))
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/customers/:id', auth, requirePermission('customers.update'), async (req, res) => {
  try {
    const c = await Customer.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    if (ownOnly(req, 'customers.view_all') && String(c.createdBy) !== String(req.user.id)) return denyScoped(res);

    c.fullName = req.body.full_name !== undefined ? req.body.full_name : c.fullName;
    c.phone = req.body.phone !== undefined ? req.body.phone : c.phone;
    c.email = req.body.email !== undefined ? req.body.email : c.email;
    c.type = req.body.type !== undefined ? req.body.type : c.type;
    c.notes = req.body.notes !== undefined ? req.body.notes : c.notes;
    if (req.body.password) {
      c.passwordHash = bcrypt.hashSync(req.body.password, 10);
    }
    await c.save();

    await audit(req.user.id, 'update', 'customer', c._id, req.body);
    res.json({ id: c._id, full_name: c.fullName });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/customers/:id', auth, requirePermission('customers.delete'), async (req, res) => {
  try {
    const c = await Customer.findByIdAndDelete(req.params.id);
    if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    await audit(req.user.id, 'delete', 'customer', req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// SUPPLIERS ROUTING
// -------------------------------------------------------------
app.get('/api/suppliers', auth, requirePermission('suppliers.view'), async (req, res) => {
  try {
    const q = req.query.q || '';
    const filter = {};
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { notes: { $regex: q, $options: 'i' } }
      ];
    }
    const list = await Supplier.find(filter).sort({ _id: -1 });
    res.json(list.map(s => ({
      id: s._id,
      name: s.name,
      contact_name: s.contactName || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      notes: s.notes || '',
      rating: s.rating
    })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/suppliers', auth, requirePermission('suppliers.create'), async (req, res) => {
  try {
    const s = req.body;
    const sup = new Supplier({
      _id: await getNextId(Supplier),
      name: s.name,
      contactName: s.contact_name ?? null,
      phone: s.phone ?? null,
      email: s.email ?? null,
      address: s.address ?? null,
      notes: s.notes ?? null,
      rating: s.rating ?? 3
    });
    await sup.save();
    await audit(req.user.id, 'create', 'supplier', sup._id, s);
    res.status(201).json({ id: sup._id, name: sup.name });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/suppliers/:id', auth, requirePermission('suppliers.view'), async (req, res) => {
  try {
    const s = await Supplier.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    
    // Find linked warehouse documents or receipts
    const slips = await InventorySlip.find({ supplierId: s._id }).sort({ createdAt: -1 });
    const docs = await Document.find({ entityType: 'supplier', entityId: s._id }).sort({ _id: -1 });
    
    // Flatten transactions list for supplier view
    const transactions = [];
    for (const slip of slips) {
      slip.items.forEach(item => {
        transactions.push({
          book_title: item.bookTitle,
          quantity: item.quantity,
          unit_cost: item.unitCost,
          type: slip.type,
          created_at: slip.createdAt
        });
      });
    }

    res.json({
      id: s._id,
      name: s.name,
      contact_name: s.contactName || '',
      phone: s.phone || '',
      email: s.email || '',
      address: s.address || '',
      notes: s.notes || '',
      rating: s.rating,
      inventory: transactions,
      documents: docs.map(d => ({ id: d._id, original_name: d.originalName, doc_type: d.docType, title: d.title || d.originalName, created_at: d.createdAt }))
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/suppliers/:id', auth, requirePermission('suppliers.update'), async (req, res) => {
  try {
    const s = await Supplier.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    
    s.name = req.body.name !== undefined ? req.body.name : s.name;
    s.contactName = req.body.contact_name !== undefined ? req.body.contact_name : s.contactName;
    s.phone = req.body.phone !== undefined ? req.body.phone : s.phone;
    s.email = req.body.email !== undefined ? req.body.email : s.email;
    s.address = req.body.address !== undefined ? req.body.address : s.address;
    s.notes = req.body.notes !== undefined ? req.body.notes : s.notes;
    s.rating = req.body.rating !== undefined ? req.body.rating : s.rating;
    await s.save();

    await audit(req.user.id, 'update', 'supplier', s._id, req.body);
    res.json({ id: s._id, name: s.name });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/suppliers/:id', auth, requirePermission('suppliers.delete'), async (req, res) => {
  try {
    const s = await Supplier.findByIdAndDelete(req.params.id);
    if (!s) return res.status(404).json({ error: 'Không tìm thấy nhà cung cấp' });
    await audit(req.user.id, 'delete', 'supplier', req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// ORDERS ROUTING (using Mongoose Transactions)
// -------------------------------------------------------------
app.get('/api/orders', auth, requirePermission('orders.view'), async (req, res) => {
  try {
    const filter = {};
    if (ownOnly(req, 'orders.view_all')) filter.createdBy = req.user.id;
    const list = await Order.find(filter).sort({ createdAt: -1 });
    
    // Map with creator name
    const mapped = [];
    for (const o of list) {
      const u = await User.findById(o.createdBy);
      mapped.push({
        id: o._id,
        order_code: o.orderCode,
        customer_name: o.customerName || 'Khách lẻ',
        status: o.status,
        payment_method: o.paymentMethod,
        subtotal: o.subtotal,
        discount: o.discount,
        tax: o.tax,
        total: o.total,
        notes: o.notes || '',
        created_at: o.createdAt,
        created_by_name: u ? u.fullName : 'Hệ thống'
      });
    }
    res.json(mapped);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/orders', auth, requirePermission('orders.create'), async (req, res) => {
  try {
    const s = z.object({ customer_id: z.union([z.number(), z.string()]).optional(), payment_method: z.string().default('cash'), discount: z.number().default(0), tax: z.number().default(0), notes: z.string().optional(), items: z.array(z.object({ book_id: z.union([z.number(), z.string()]), quantity: z.number().int().positive() })).min(1) }).parse(req.body);
    
    let subtotal = 0;
    const pricedItems = [];
    
    for (const item of s.items) {
      const b = await Book.findById(item.book_id);
      if (!b) throw new Error('Sách không tồn tại');
      // Validate tồn kho đủ số lượng yêu cầu (chưa trừ ngay, chứ admin xác nhận hoàn thành)
      if (b.stockQuantity < item.quantity) throw new Error(`Không đủ tồn kho: ${b.title}`);
      
      const itemTotal = b.salePrice * item.quantity;
      subtotal += itemTotal;
      
      pricedItems.push({
        bookId: b._id,
        bookCode: b.code,
        bookTitle: b.title,
        quantity: item.quantity,
        unitPrice: b.salePrice,
        total: itemTotal
      });
      // Không trừ tồn kho ở đây. Tồn kho sẽ bị trừ khi admin cập nhật trạng thái đơn hàng sang 'completed'.
    }
    
    const totalVal = subtotal - s.discount + s.tax;
    const nextOrderId = await getNextId(Order);
    const code = `ORD-MAU-${String(nextOrderId).padStart(3, '0')}`;
    
    let custName = 'Khách lẻ';
    let mongoCustomerId = null;
    if (s.customer_id) {
      const c = await Customer.findById(s.customer_id);
      if (c) {
        custName = c.fullName;
        mongoCustomerId = c._id;
      }
    }

    const orderObj = new Order({
      _id: nextOrderId,
      orderCode: code,
      customerId: mongoCustomerId,
      customerName: custName,
      status: 'paid',
      paymentMethod: s.payment_method,
      subtotal,
      discount: s.discount,
      tax: s.tax,
      total: totalVal,
      notes: s.notes || null,
      createdBy: req.user.id,
      items: pricedItems
    });
    await orderObj.save();

    // Cập nhật Leaderboard Redis ngay khi đơn hàng được tạo
    if (isRedisActive() && pricedItems.length) {
      const month = new Date().toISOString().slice(0, 7);
      await cacheService.incrementLeaderboard(
        pricedItems.map(i => ({ bookId: i.bookId, bookTitle: i.bookTitle, quantity: i.quantity })),
        month
      );
    }

    await audit(req.user.id, 'create', 'order', orderObj._id, s);
    res.status(201).json({ id: orderObj._id, order_code: orderObj.orderCode });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/orders/:id', auth, requirePermission('orders.update', 'orders.create'), async (req, res) => {
  try {
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    const { status, notes } = req.body;
    const oldStatus = o.status;
    const validStatuses = ['new', 'paid', 'shipping', 'completed', 'cancelled'];
    if (status !== undefined) {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${validStatuses.join(', ')}` });
      }
      o.status = status;

      // Khi Admin cập nhật trạng thái sang 'completed' (Hoàn thành)
      if (oldStatus !== 'completed' && status === 'completed') {
        // 1. Cập nhật điểm Leaderboard sách bán chạy trong Redis (nếu chưa cập nhật)
        const month = new Date(o.createdAt || Date.now()).toISOString().slice(0, 7);
        if (isRedisActive() && o.items && o.items.length) {
          await cacheService.incrementLeaderboard(
            o.items.map(i => ({ bookId: i.bookId, bookTitle: i.bookTitle, quantity: i.quantity })),
            month
          );
        }
        // 2. Trừ tồn kho — chỉ thực hiện ở bước này khi admin xác nhận hoàn thành
        for (const item of (o.items || [])) {
          const bId = item.bookId;
          if (bId) {
            const b = await Book.findById(bId);
            if (b) {
              b.stockQuantity = Math.max(0, b.stockQuantity - (item.quantity || 1));
              b.updatedAt = new Date();
              await b.save();
            }
          }
        }
        console.log(`[Order] Đơn hàng ${o.orderCode} hoàn thành. Đã trừ tồn kho và cập nhật leaderboard.`);
      }
    }
    if (notes !== undefined) o.notes = notes;
    o.updatedAt = new Date();
    await o.save();
    await audit(req.user.id, 'update_status', 'order', o._id, { status: o.status, notes: o.notes });
    res.json({ id: o._id, order_code: o.orderCode, status: o.status, notes: o.notes });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/orders/:id', auth, requirePermission('orders.view'), async (req, res) => {
  try {
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (ownOnly(req, 'orders.view_all') && String(o.createdBy) !== String(req.user.id)) return denyScoped(res);
    
    const docs = await Document.find({ entityType: 'order', entityId: o._id }).sort({ _id: -1 });

    res.json({
      id: o._id,
      order_code: o.orderCode,
      customer_id: o.customerId,
      customer_name: o.customerName || 'Khách lẻ',
      status: o.status,
      payment_method: o.paymentMethod,
      subtotal: o.subtotal,
      discount: o.discount,
      tax: o.tax,
      total: o.total,
      notes: o.notes || '',
      created_at: o.createdAt,
      items: o.items.map(i => ({
        book_id: i.bookId,
        book_code: i.bookCode,
        book_title: i.bookTitle,
        quantity: i.quantity,
        unit_price: i.unitPrice,
        total: i.total
      })),
      documents: docs.map(d => ({ id: d._id, original_name: d.originalName, doc_type: d.docType, title: d.title || d.originalName, created_at: d.createdAt }))
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/orders/:id/cancel', auth, requirePermission('orders.cancel'), async (req, res) => {
  try {
    const o = await Order.findById(req.params.id);
    if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    if (ownOnly(req, 'orders.view_all') && String(o.createdBy) !== String(req.user.id)) return denyScoped(res);
    if (o.status === 'cancelled') return res.status(400).json({ error: 'Đơn hàng đã hủy' });
    if (o.status === 'completed') return res.status(400).json({ error: 'Không thể hủy đơn hàng đã hoàn thành' });
    
    const reason = req.body?.reason || 'Hủy đơn và hoàn tồn kho';

    for (const item of o.items) {
      const b = await Book.findById(item.bookId);
      if (b) {
        b.stockQuantity += item.quantity;
        b.updatedAt = new Date();
        await b.save();
      }
    }
    
    o.status = 'cancelled';
    o.notes = (o.notes || '') + `\n[CANCEL] ${reason}`;
    await o.save();
    
    await audit(req.user.id, 'cancel', 'order', o._id, { reason });
    res.json({ id: o._id, status: o.status });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/orders/:id', auth, requirePermission('orders.cancel'), async (req, res) => {
  try {
    const o = await Order.findByIdAndDelete(req.params.id);
    if (!o) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    await audit(req.user.id, 'delete', 'order', req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// INVENTORY & WAREHOUSE ROUTING
// -------------------------------------------------------------
app.get('/api/inventory', auth, requirePermission('inventory.view'), async (req, res) => {
  try {
    const list = await Book.find({}).sort({ stockQuantity: 1 });
    res.json(list.map(b => ({
      book_id: b._id,
      code: b.code,
      title: b.title,
      stock_quantity: b.stockQuantity,
      import_price: b.importPrice,
      sale_price: b.salePrice,
      category: b.category || ''
    })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/inventory/slips', auth, requirePermission('inventory.view'), async (req, res) => {
  try {
    const list = await InventorySlip.find({}).sort({ createdAt: -1 }).limit(200);
    const mapped = [];
    for (const sl of list) {
      const sup = sl.supplierId ? await Supplier.findById(sl.supplierId) : null;
      const u = await User.findById(sl.createdBy);
      
      let totalCost = 0;
      sl.items.forEach(item => {
        totalCost += Math.abs(item.quantity) * (item.unitCost || 0);
      });

      mapped.push({
        id: sl._id,
        slip_code: sl.slipCode,
        type: sl.type,
        supplier_name: sup ? sup.name : 'Kiểm kho/Điều chỉnh',
        created_by_name: u ? u.fullName : 'Hệ thống',
        item_count: sl.items.length,
        total_cost: totalCost,
        status: sl.status,
        created_at: sl.createdAt
      });
    }
    res.json(mapped);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/inventory/slips/:id', auth, requirePermission('inventory.view'), async (req, res) => {
  try {
    const sl = await InventorySlip.findById(req.params.id);
    if (!sl) return res.status(404).json({ error: 'Không tìm thấy phiếu kho' });
    
    const sup = sl.supplierId ? await Supplier.findById(sl.supplierId) : null;
    const u = await User.findById(sl.createdBy);
    const docs = await Document.find({ entityType: 'inventory_slip', entityId: sl._id }).sort({ _id: -1 });

    res.json({
      id: sl._id,
      slip_code: sl.slipCode,
      type: sl.type,
      supplier_name: sup ? sup.name : 'Điều chỉnh kho',
      created_by_name: u ? u.fullName : 'Hệ thống',
      status: sl.status,
      note: sl.note || '',
      created_at: sl.createdAt,
      items: sl.items.map(i => ({
        book_id: i.bookId,
        book_code: i.bookCode,
        book_title: i.bookTitle,
        quantity: i.quantity,
        unit_cost: i.unitCost,
        note: i.note || ''
      })),
      documents: docs.map(d => ({ id: d._id, original_name: d.originalName, doc_type: d.docType, title: d.title || d.originalName, created_at: d.createdAt }))
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/inventory/slips', auth, requirePermission('inventory.import','inventory.export','inventory.adjust'), async (req, res) => {
  try {
    const s = z.object({ type: z.enum(['in', 'out', 'adjust']), supplier_id: z.union([z.number(), z.string()]).optional(), note: z.string().optional(), items: z.array(z.object({ book_id: z.union([z.number(), z.string()]), quantity: z.number().int(), unit_cost: z.number().default(0) })).min(1) }).parse(req.body);
    
    if (s.type === 'in' && !req.user.permissions.includes('inventory.import')) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện nhập kho' });
    }
    if (s.type === 'out' && !req.user.permissions.includes('inventory.export')) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện xuất kho' });
    }
    if (s.type === 'adjust' && !req.user.permissions.includes('inventory.adjust')) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện điều chỉnh kho' });
    }
    
    const code = `SLIP-${s.type.toUpperCase()}-${Date.now()}`;
    const mappedItems = [];
    
    for (const item of s.items) {
      const b = await Book.findById(item.book_id);
      if (!b) throw new Error('Sách không tồn tại');
      
      const delta = s.type === 'in' ? Math.abs(item.quantity) : s.type === 'out' ? -Math.abs(item.quantity) : item.quantity;
      if (s.type === 'out' && b.stockQuantity < Math.abs(item.quantity)) {
        throw new Error(`Không đủ tồn kho: ${b.title}`);
      }
      
      mappedItems.push({
        bookId: b._id,
        bookCode: b.code,
        bookTitle: b.title,
        quantity: delta,
        unitCost: item.unit_cost,
        note: s.note || code
      });
      
      b.stockQuantity += delta;
      if (item.unit_cost > 0 && s.type === 'in') {
        b.importPrice = item.unit_cost;
      }
      b.updatedAt = new Date();
      await b.save();
    }
    
    let mongoSupplierId = null;
    if (s.supplier_id) {
      const sup = await Supplier.findById(s.supplier_id);
      if (sup) mongoSupplierId = sup._id;
    }

    const slip = new InventorySlip({
      _id: await getNextId(InventorySlip),
      slipCode: code,
      type: s.type,
      supplierId: mongoSupplierId,
      note: s.note || null,
      createdBy: req.user.id,
      items: mappedItems
    });
    await slip.save();
    
    await audit(req.user.id, 'create', 'inventory_slip', slip._id, s);
    res.status(201).json({ id: slip._id, slip_code: slip.slipCode });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/inventory/slips/:id/cancel', auth, requirePermission('inventory.adjust'), async (req, res) => {
  try {
    const sl = await InventorySlip.findById(req.params.id);
    if (!sl) return res.status(404).json({ error: 'Không tìm thấy phiếu kho' });
    if (sl.status === 'cancelled') return res.status(400).json({ error: 'Phiếu kho đã hủy' });
    
    const reason = req.body?.reason || 'Hủy phiếu và đảo kho';

    for (const item of sl.items) {
      const b = await Book.findById(item.bookId);
      if (!b) throw new Error('Sách không tồn tại');
      
      const reverse = -item.quantity;
      if (reverse < 0 && b.stockQuantity < Math.abs(reverse)) {
        throw new Error(`Không đủ tồn kho để đảo kho: ${b.title}`);
      }
      
      b.stockQuantity += reverse;
      b.updatedAt = new Date();
      await b.save();
    }
    
    sl.status = 'cancelled';
    sl.cancelledAt = new Date();
    sl.cancelledBy = req.user.id;
    sl.note = (sl.note || '') + `\n[CANCEL] ${reason}`;
    await sl.save();
    
    await audit(req.user.id, 'cancel', 'inventory_slip', sl._id, { reason });
    res.json({ id: sl._id, status: sl.status });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// DOCUMENTS & UNSTRUCTURED DATA ROUTING
// -------------------------------------------------------------
app.get('/api/documents', auth, requirePermission('documents.view'), async (req, res) => {
  try {
    const q = req.query.q || '';
    const entityType = req.query.entity_type;
    const entityId = req.query.entity_id;
    const own = ownOnly(req, 'documents.view_all');
    
    const filter = {};
    if (own) filter.uploadedBy = req.user.id;
    if (entityType && entityId) {
      filter.entityType = entityType;
      filter.entityId = Number(entityId);
    } else if (q) {
      filter.$or = [
        { originalName: { $regex: q, $options: 'i' } },
        { title: { $regex: q, $options: 'i' } },
        { notes: { $regex: q, $options: 'i' } },
        { extractedText: { $regex: q, $options: 'i' } }
      ];
    }
    
    const list = await Document.find(filter).sort({ _id: -1 });
    res.json(list.map(d => ({
      id: d._id,
      original_name: d.originalName,
      stored_name: d.storedName,
      mime_type: d.mimeType,
      size: d.size,
      checksum: d.checksum || '',
      doc_type: d.docType,
      entity_type: d.entityType || null,
      entity_id: d.entityId || null,
      title: d.title || d.originalName,
      notes: d.notes || '',
      is_important: d.isImportant ? 1 : 0,
      extracted_text: d.extractedText || '',
      ocr_status: d.ocrStatus,
      processing_error: d.processingError || null,
      uploaded_by: d.uploadedBy,
      created_at: d.createdAt,
      updated_at: d.updatedAt
    })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/documents', auth, requirePermission('documents.upload'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Thiếu file' });
  try {
    await validateUploadFile(req.file);
    const decodedOriginalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const checksum = sha256(req.file.path);
    const duplicate = await Document.findOne({ checksum }).select('id originalName');
    
    const extracted = await extractText(req.file);
    
    let docType = req.body.doc_type || 'internal';
    let isAutoClassified = false;
    if (docType === 'auto') {
      docType = classifyDocument(extracted.text);
      isAutoClassified = true;
    }
    
    const extraMeta = {
      originalExtension: path.extname(decodedOriginalName),
      storage: 'local',
      checksum,
      duplicateOf: duplicate ? String(duplicate._id) : null
    };
    if (isAutoClassified) extraMeta.autoClassified = 'true';
    const postMeta = parseMetadata(req.body);
    const mergedMeta = { ...postMeta, ...extraMeta };

    let mongoEntityId = null;
    if (req.body.entity_id) {
      mongoEntityId = Number(req.body.entity_id);
    }

    const doc = new Document({
      _id: await getNextId(Document),
      originalName: decodedOriginalName,
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      checksum,
      docType,
      entityType: req.body.entity_type || null,
      entityId: mongoEntityId,
      title: req.body.title || decodedOriginalName,
      notes: req.body.notes || '',
      isImportant: req.body.is_important === 'true',
      extractedText: extracted.text,
      ocrStatus: extracted.status,
      processingError: extracted.error || null,
      uploadedBy: req.user.id,
      metadata: mergedMeta
    });
    await doc.save();
    
    await syncBookFieldsFromDocument(doc._id);
    await audit(req.user.id, 'upload', 'document', doc._id, { docType, checksum, duplicateOf: duplicate ? duplicate._id : null });
    
    res.status(201).json({ id: doc._id, original_name: doc.originalName });
  } catch(e) {
    try { fs.unlinkSync(req.file.path); } catch(err) {}
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/documents/:id', auth, requirePermission('documents.view'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (ownOnly(req, 'documents.view_all') && String(d.uploadedBy) !== String(req.user.id)) return denyScoped(res);
    
    // Map metadata format
    const metaArray = [];
    if (d.metadata) {
      d.metadata.forEach((v, k) => {
        metaArray.push({ meta_key: k, meta_value: v });
      });
    }

    res.json({
      id: d._id,
      original_name: d.originalName,
      stored_name: d.storedName,
      mime_type: d.mimeType,
      size: d.size,
      checksum: d.checksum || '',
      doc_type: d.docType,
      entity_type: d.entityType || null,
      entity_id: d.entityId || null,
      title: d.title || d.originalName,
      notes: d.notes || '',
      is_important: d.isImportant ? 1 : 0,
      extracted_text: d.extractedText || '',
      ocr_status: d.ocrStatus,
      processing_error: d.processingError || null,
      uploaded_by: d.uploadedBy,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
      metadata: metaArray,
      preview_url: `/api/documents/${d._id}/preview`,
      text_url: `/api/documents/${d._id}/text`,
      download_url: `/api/documents/${d._id}/download`
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/documents/:id/text', auth, requirePermission('documents.view'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id).select('extractedText processingError uploadedBy');
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (ownOnly(req, 'documents.view_all') && String(d.uploadedBy) !== String(req.user.id)) return denyScoped(res);
    res.type('text/plain; charset=utf-8').send(d.extractedText || d.processingError || '');
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/documents/:id', auth, requirePermission('documents.update'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (ownOnly(req, 'documents.view_all') && String(d.uploadedBy) !== String(req.user.id)) return denyScoped(res);
    
    d.docType = req.body.doc_type !== undefined ? req.body.doc_type : d.docType;
    d.entityType = req.body.entity_type !== undefined ? req.body.entity_type : d.entityType;
    d.entityId = req.body.entity_id ? Number(req.body.entity_id) : d.entityId;
    d.title = req.body.title !== undefined ? req.body.title : d.title;
    d.notes = req.body.notes !== undefined ? req.body.notes : d.notes;
    d.isImportant = req.body.is_important !== undefined ? req.body.is_important === 1 : d.isImportant;
    d.updatedAt = new Date();
    
    if (req.body.metadata) {
      Object.entries(req.body.metadata).forEach(([k, v]) => {
        d.metadata.set(k, String(v));
      });
    }
    await d.save();
    
    await syncBookFieldsFromDocument(d._id);
    await audit(req.user.id, 'update', 'document', d._id, req.body);
    res.json({ id: d._id, title: d.title });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/documents/:id', auth, requirePermission('documents.delete'), async (req, res) => {
  try {
    const d = await Document.findByIdAndDelete(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (ownOnly(req, 'documents.view_all') && String(d.uploadedBy) !== String(req.user.id)) return denyScoped(res);
    
    await Book.updateMany({ coverDocumentId: d._id }, { coverDocumentId: null });
    try { fs.unlinkSync(path.join(uploadDir, d.storedName)); } catch(e) {}
    
    await audit(req.user.id, 'delete', 'document', req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/documents/:id/reprocess', auth, requirePermission('documents.update'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (ownOnly(req, 'documents.view_all') && String(d.uploadedBy) !== String(req.user.id)) return denyScoped(res);
    
    const file = { path: path.join(uploadDir, d.storedName), mimetype: d.mimeType };
    const extracted = await extractText(file);
    
    const autoClassified = d.metadata && d.metadata.get('autoClassified') === 'true';
    if (autoClassified) {
      d.docType = classifyDocument(extracted.text);
    }
    
    d.extractedText = extracted.text;
    d.ocrStatus = extracted.status;
    d.processingError = extracted.error || null;
    d.updatedAt = new Date();
    await d.save();
    
    await syncBookFieldsFromDocument(d._id);
    await audit(req.user.id, 'reprocess', 'document', d._id);
    res.json({ id: d._id, ocr_status: d.ocrStatus });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/documents/:id/preview', auth, requirePermission('documents.view'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (ownOnly(req, 'documents.view_all') && String(d.uploadedBy) !== String(req.user.id)) return denyScoped(res);
    
    res.setHeader('Content-Type', d.mimeType);
    if (d.mimeType !== 'application/pdf') {
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.originalName)}"`);
    }
    fs.createReadStream(path.join(uploadDir, d.storedName)).pipe(res);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/documents/:id/download', auth, requirePermission('documents.view'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (ownOnly(req, 'documents.view_all') && String(d.uploadedBy) !== String(req.user.id)) return denyScoped(res);
    
    const filePath = path.join(uploadDir, d.storedName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File vật lý không tồn tại' });
    
    res.setHeader('Content-Type', d.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.originalName)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Customer Auth ──
function customerAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const isPublicGet = (req.method === 'GET' && (
    req.path === '/api/customer/books' || 
    /^\/api\/customer\/books\/[^\/]+$/.test(req.path) || 
    /^\/api\/customer\/documents\/[^\/]+\/cover$/.test(req.path)
  ));

  if (!token) {
    if (isPublicGet) {
      req.customer = null;
      return next();
    }
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'customer' && payload.type !== 'otp' && payload.role !== 'customer') {
      if (isPublicGet) {
        req.customer = null;
        return next();
      }
      return res.status(403).json({ error: 'Token không hợp lệ' });
    }
    req.customer = payload;
    next();
  } catch {
    if (isPublicGet) {
      req.customer = null;
      return next();
    }
    res.status(401).json({ error: 'Token không hợp lệ' });
  }
}

app.post('/api/customer/register', async (req, res) => {
  try {
    const s = z.object({
      full_name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      phone: z.string().optional()
    }).parse(req.body);
    const existing = await Customer.findOne({ email: s.email });
    if (existing) return res.status(400).json({ error: 'Email này đã được đăng ký.' });
    const hash = bcrypt.hashSync(s.password, 10);
    const c = new Customer({
      _id: await getNextId(Customer),
      fullName: s.full_name,
      email: s.email,
      phone: s.phone || null,
      passwordHash: hash,
      type: 'retail',
      isActive: true
    });
    await c.save();
    await audit(null, 'create', 'customer', c._id, { email: s.email });
    res.status(201).json({ ok: true, message: 'Đăng ký thành công. Vui lòng đăng nhập.' });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ error: 'Dữ liệu không hợp lệ: ' + e.message });
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/customer/login', async (req, res) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const email = body.email.trim().toLowerCase();
    const c = await Customer.findOne({ email: new RegExp('^' + email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), isActive: true });
    if (!c || !c.passwordHash || !bcrypt.compareSync(body.password, c.passwordHash))
      return res.status(401).json({ error: 'Sai email hoặc mật khẩu' });
    const token = jwt.sign({ id: c._id, email: c.email, fullName: c.fullName, type: 'customer' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, customer: { id: c._id, email: c.email, full_name: c.fullName, phone: c.phone, type: c.type } });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

async function computeCustomerSegment(customerId) {
  try {
    const allCustomers = await Customer.find({});
    const allOrders = await Order.find({});
    const rows = [];
    for (const c of allCustomers) {
      const customerOrders = allOrders.filter(o => o.customerId && o.customerId.toString() === c._id.toString());
      const totalSpent = customerOrders.reduce((sum, o) => sum + (o.total || 0), 0);
      const orderCount = customerOrders.length;
      rows.push({ id: c._id.toString(), total_spent: totalSpent, order_count: orderCount });
    }
    if (rows.length < 4) return 'Chưa đủ dữ liệu';
    const rawData = rows.map(r => [r.total_spent, r.order_count]);
    const segmentation = require('./customer-segmentation');
    const result = segmentation.kmeans(rawData, 4);
    const segNames = ['VIP', 'Khách thân thiết', 'Khách vãng lai', 'Học sinh / Sinh viên'];
    const k = result.centroids.length;
    const clusterStats = [];
    for (let j = 0; j < k; j++) {
      const members = rawData.filter((_, i) => result.labels[i] === j);
      if (members.length === 0) { clusterStats.push({ totalSpent: 0, orderCount: 0, count: 0 }); continue; }
      const avgSpent = members.reduce((s, r) => s + r[0], 0) / members.length;
      const avgOrders = members.reduce((s, r) => s + r[1], 0) / members.length;
      clusterStats.push({ totalSpent: avgSpent, orderCount: avgOrders, count: members.length });
    }
    const scores = clusterStats.map(s => ({ ...s, score: (s.totalSpent || 0) * 0.7 + (s.orderCount || 0) * 0.3 }));
    const ranked = scores.map((s, i) => ({ ...s, clusterId: i })).sort((a, b) => b.score - a.score);
    const clusterToLabel = {};
    ranked.forEach((s, rank) => { clusterToLabel[s.clusterId] = segNames[Math.min(rank, segNames.length - 1)]; });
    const customerIdx = rows.findIndex(r => r.id === customerId.toString());
    if (customerIdx === -1) return 'Không xác định';
    return clusterToLabel[result.labels[customerIdx]] || 'Không xác định';
  } catch (e) {
    return 'Không xác định';
  }
}

app.get('/api/customer/me', customerAuth, async (req, res) => {
  try {
    const c = await Customer.findById(req.customer.id);
    if (!c) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    const orders = await Order.find({
      $or: [
        { customerId: c._id },
        { createdBy: c._id },
        { customerName: c.fullName }
      ]
    }).sort({ createdAt: -1 });
    const feedbacks = await Feedback.find({ customerId: c._id }).sort({ createdAt: -1 });
    const segment = await computeCustomerSegment(c._id);
    const customerTotal = orders.reduce((sum, o) => sum + (o.total || 0), 0);
    const mappedFeedbacks = [];
    for (const f of feedbacks) {
      const book = await Book.findById(f.bookId);
      mappedFeedbacks.push({
        id: f._id,
        book_id: f.bookId,
        book_title: book ? book.title : '',
        rating: f.rating,
        comment: f.comment,
        tags: f.tags,
        sentiment: f.sentiment,
        score: f.score,
        isFeatured: f.isFeatured,
        status: f.status,
        created_at: f.createdAt,
        media: (f.media || []).map((m, idx) => ({
          fileName: m.fileName,
          fileType: m.fileType,
          fileSizeKB: m.fileSizeKB,
          url: `/api/feedbacks/media/${f._id}/${idx}`
        }))
      });
    }
    res.json({
      id: c._id,
      full_name: c.fullName,
      phone: c.phone,
      email: c.email,
      type: c.type,
      notes: c.notes,
      segment: segment,
      total_spent: customerTotal,
      order_count: orders.length,
      created_at: c.createdAt,
      orders: orders.map(o => ({
        id: o._id,
        order_code: o.orderCode,
        status: o.status,
        payment_method: o.paymentMethod,
        subtotal: o.subtotal,
        discount: o.discount,
        tax: o.tax,
        total: o.total,
        notes: o.notes,
        created_at: o.createdAt
      })),
      feedbacks: mappedFeedbacks
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/customer/books', customerAuth, async (req, res) => {
  try {
    let list = await Book.find({ isActive: true }).lean();
    // AI sort: sách được đánh giá cao, nhiều isFeatured → ưu tiên lên đầu
    const bookIds = list.map(b => b._id);
    const feedbackStats = await Feedback.aggregate([
      { $match: { bookId: { $in: bookIds } } },
      { $group: {
        _id: '$bookId',
        avgRating: { $avg: '$rating' },
        featuredCount: { $sum: { $cond: ['$isFeatured', 1, 0] } },
        feedbackCount: { $sum: 1 }
      }}
    ]);
    const statsMap = {};
    feedbackStats.forEach(s => {
      statsMap[s._id] = { avgRating: s.avgRating || 0, featuredCount: s.featuredCount || 0, feedbackCount: s.feedbackCount || 0 };
    });
    list.sort((a, b) => {
      const sa = statsMap[a._id] || { avgRating: 0, featuredCount: 0, feedbackCount: 0 };
      const sb = statsMap[b._id] || { avgRating: 0, featuredCount: 0, feedbackCount: 0 };
      // featuredCount*3 + avgRating*0.5 + feedbackCount*0.1
      const scoreA = sa.featuredCount * 3 + (sa.avgRating || 0) * 0.5 + sa.feedbackCount * 0.1;
      const scoreB = sb.featuredCount * 3 + (sb.avgRating || 0) * 0.5 + sb.feedbackCount * 0.1;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.title.localeCompare(b.title, 'vi');
    });
    res.json(list.map(b => ({
      id: b._id,
      code: b.code,
      title: b.title,
      author: b.author,
      category: b.category,
      sale_price: b.salePrice,
      stock_quantity: b.stockQuantity,
      description: b.description,
      is_active: b.isActive ? 1 : 0,
      cover_document_id: b.coverDocumentId
    })));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/customer/orders', customerAuth, async (req, res) => {
  try {
    const s = z.object({
      items: z.array(z.object({ book_id: z.number(), quantity: z.number().int().positive() })).min(1)
    }).parse(req.body);
    let subtotal = 0;
    const priced = [];
    for (const item of s.items) {
      const b = await Book.findOne({ _id: item.book_id, isActive: true });
      if (!b) throw new Error('Sách không tồn tại hoặc đã ngưng bán');
      // Validate tồn kho đủ số lượng yêu cầu (chưa trừ ngay, chứ admin xác nhận hoàn thành)
      if (b.stockQuantity < item.quantity) throw new Error('Không đủ tồn kho: ' + b.title + ' (còn ' + b.stockQuantity + ')');
      const total = b.salePrice * item.quantity;
      subtotal += total;
      // Không trừ tồn kho ở đây. Tồn kho sẽ bị trừ khi admin chuyển đơn sang 'completed'.
      priced.push({
        bookId: b._id,
        bookCode: b.code,
        bookTitle: b.title,
        quantity: item.quantity,
        unitPrice: b.salePrice,
        total
      });
    }
    const nextOrderId = await getNextId(Order);
    const orderCode = `ORD-MAU-${String(nextOrderId).padStart(3, '0')}`;
    const custRecord = await Customer.findById(req.customer.id);
    const custName = custRecord ? custRecord.fullName : (req.customer.fullName || 'Khách hàng');
    const orderObj = new Order({
      _id: nextOrderId,
      orderCode,
      customerId: req.customer.id,
      customerName: custName,
      paymentMethod: 'cash',
      subtotal,
      discount: 0,
      tax: 0,
      total: subtotal,
      status: 'paid',
      items: priced
    });
    await orderObj.save();
    await audit(null, 'create', 'order', orderObj._id, { customer_id: req.customer.id, items: priced });
    res.status(201).json({
      id: orderObj._id,
      order_code: orderObj.orderCode
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/customer/documents/:id/cover', customerAuth, async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    res.setHeader('Content-Type', d.mimeType);
    if (d.mimeType !== 'application/pdf') {
      res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(d.originalName) + '"');
    }
    fs.createReadStream(path.join(uploadDir, d.storedName)).pipe(res);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/customer/books/:id', customerAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = await Book.findById(Number.isFinite(id) ? id : req.params.id);
    if (!b) return res.status(404).json({ error: 'Không tìm thấy sách' });
    const relatedOrders = await Order.find({ 'items.bookId': b._id }).select('_id items');
    const orderIds = relatedOrders.map(o => o._id);
    let recommendations = [];
    if (orderIds.length > 0) {
      const counts = {};
      relatedOrders.forEach(o => {
        o.items.forEach(item => {
          if (item.bookId !== b._id) {
            counts[item.bookId] = (counts[item.bookId] || 0) + 1;
          }
        });
      });
      const sortedBooks = Object.entries(counts)
        .map(([idStr, count]) => ({ bookId: Number(idStr), co_count: count }))
        .sort((x, y) => y.co_count - x.co_count)
        .slice(0, 3);
      for (const r of sortedBooks) {
        const book = await Book.findById(r.bookId);
        if (book) {
          recommendations.push({
            id: book._id,
            title: book.title,
            author: book.author,
            price: book.salePrice,
            confidence: Math.round((r.co_count / orderIds.length) * 100)
          });
        }
      }
    }
    if (recommendations.length < 3 && b.author) {
      const existingIds = recommendations.map(r => r.id);
      existingIds.push(b._id);
      const sameAuthorBooks = await Book.find({
        author: b.author,
        _id: { $nin: existingIds },
        isActive: true
      }).limit(3 - recommendations.length);
      sameAuthorBooks.forEach(s => {
        recommendations.push({
          id: s._id,
          title: s.title,
          author: s.author,
          price: s.salePrice,
          confidence: null
        });
      });
    }
    res.json({
      id: b._id,
      code: b.code,
      title: b.title,
      author: b.author,
      category: b.category,
      publisher: b.publisher,
      isbn: b.isbn,
      published_year: b.publishedYear,
      pages: b.pages,
      language: b.language,
      sale_price: b.salePrice,
      stock_quantity: b.stockQuantity,
      description: b.description,
      excerpt: b.excerpt,
      cover_document_id: b.coverDocumentId,
      recommendations: recommendations.slice(0, 3)
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── CUSTOMER FEEDBACK APIS (cho product.html) ──

app.get('/api/customer/feedback/book/:bookId', async (req, res) => {
  try {
    const bookId = parseInt(req.params.bookId);
    if (isNaN(bookId)) return res.status(400).json({ error: 'ID sách không hợp lệ' });
    const list = await Feedback.find({ bookId, status: { $ne: 'resolved' } })
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(50);
    res.json(list.map(f => ({
      id: f._id,
      bookId: f.bookId,
      customerId: f.customerId,
      customerName: f.customerName,
      email: f.email,
      rating: f.rating,
      comment: f.comment,
      tags: f.tags,
      sentiment: f.sentiment,
      score: f.score,
      isFeatured: f.isFeatured,
      createdAt: f.createdAt,
      media: (f.media || []).map((m, idx) => ({
        fileName: m.fileName,
        fileType: m.fileType,
        fileSizeKB: m.fileSizeKB,
        url: `/api/feedbacks/media/${f._id}/${idx}`
      }))
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/customer/feedback/my', customerAuth, async (req, res) => {
  try {
    const list = await Feedback.find({ customerId: req.customer.id })
      .sort({ createdAt: -1 })
      .limit(50);
    const mapped = [];
    for (const f of list) {
      const book = await Book.findById(f.bookId);
      mapped.push({
        id: f._id,
        bookId: f.bookId,
        book_title: book ? book.title : '',
        rating: f.rating,
        comment: f.comment,
        tags: f.tags,
        sentiment: f.sentiment,
        score: f.score,
        status: f.status,
        createdAt: f.createdAt,
        media: (f.media || []).map((m, idx) => ({
          fileName: m.fileName,
          fileType: m.fileType,
          fileSizeKB: m.fileSizeKB,
          url: `/api/feedbacks/media/${f._id}/${idx}`
        }))
      });
    }
    res.json(mapped);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/customer/feedback', customerAuth, memoryUpload.array('images', 5), async (req, res) => {
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

    let tags = [];
    try { if (tags_json) tags = JSON.parse(tags_json); } catch {}
    if (!Array.isArray(tags) && typeof tags_json === 'string') {
      tags = tags_json.split(',').map(x => x.trim()).filter(Boolean);
    }

    const mappedMedia = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        mappedMedia.push({
          fileName: file.originalname,
          fileType: file.mimetype,
          fileSizeKB: Math.round(file.size / 1024),
          fileData: file.buffer
        });
      }
    }

    const feedback = new Feedback({
      _id: await getNextId(Feedback),
      bookId: book_id ? parseInt(book_id) : null,
      customerId: req.customer.id,
      customerName: req.customer.fullName,
      email: req.customer.email,
      rating: ratingNum,
      comment,
      tags,
      media: mappedMedia,
      sentiment: sentiment.sentiment,
      score: sentiment.score,
      isFeatured,
      status
    });
    await feedback.save();
    await audit(null, 'create', 'feedback', feedback._id, { book_id: book_id ? parseInt(book_id) : null, rating: ratingNum, sentiment: sentiment.sentiment });
    res.json({ id: feedback._id, sentiment, isFeatured, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -------------------------------------------------------------
// SEARCH ROUTING (MongoDB Text & Regex Search)
// -------------------------------------------------------------
function makeSnippet(text, query) {
  if (!text) return '';
  const words = query.split(/\s+/).filter(Boolean);
  if (words.length === 0) return text.slice(0, 150);
  
  let firstIndex = -1;
  let foundWord = '';
  for (const w of words) {
    const idx = text.toLowerCase().indexOf(w.toLowerCase());
    if (idx !== -1 && (firstIndex === -1 || idx < firstIndex)) {
      firstIndex = idx;
      foundWord = w;
    }
  }

  if (firstIndex === -1) {
    return text.length > 150 ? text.slice(0, 150) + '...' : text;
  }

  const start = Math.max(0, firstIndex - 40);
  const end = Math.min(text.length, firstIndex + foundWord.length + 80);
  let snippet = text.slice(start, end);

  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  words.forEach(w => {
    try {
      const regex = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      snippet = snippet.replace(regex, '<mark>$1</mark>');
    } catch (e) {}
  });

  return snippet;
}

app.get('/api/search', auth, requirePermission('search.use'), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  
  const cleanQ = q.replace(/[^\w\s\dàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, ' ').trim();
  if (!cleanQ) return res.json([]);

  try {
    const words = cleanQ.split(/\s+/).filter(Boolean);
    let textBooks = [];
    let textDocs = [];

    // 1. Text Index search (logical AND style by wrapping in quotes)
    if (words.length > 0) {
      const andSearchQuery = words.map(w => `"${w}"`).join(' ');
      try {
        [textBooks, textDocs] = await Promise.all([
          Book.find({ $text: { $search: andSearchQuery } }, { score: { $meta: 'textScore' } }).limit(25),
          Document.find({ $text: { $search: andSearchQuery } }, { score: { $meta: 'textScore' } }).limit(25)
        ]);
      } catch (indexErr) {
        console.warn('Text index search failed or not ready:', indexErr.message);
      }
    }

    // 2. Substring Regex search (logical AND across fields)
    let regexBooks = [];
    let regexDocs = [];

    if (words.length > 0) {
      const bookRegexQuery = {
        $and: words.map(w => {
          const pattern = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          return {
            $or: [
              { title: pattern },
              { code: pattern },
              { author: pattern },
              { publisher: pattern },
              { isbn: pattern }
            ]
          };
        })
      };
      
      const docRegexQuery = {
        $and: words.map(w => {
          const pattern = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          return {
            $or: [
              { title: pattern },
              { originalName: pattern },
              { notes: pattern }
            ]
          };
        })
      };

      [regexBooks, regexDocs] = await Promise.all([
        Book.find(bookRegexQuery).limit(25),
        Document.find(docRegexQuery).limit(25)
      ]);
    }

    // 3. Merge & score results
    const matchedBooks = new Map();
    const matchedDocs = new Map();
    const cleanQueryStr = q.replace(/[^\w\d]/g, '').toLowerCase();

    textBooks.forEach(b => {
      matchedBooks.set(b._id.toString(), {
        doc: b,
        score: b._doc.score || 1.0
      });
    });

    regexBooks.forEach(b => {
      const idStr = b._id.toString();
      if (matchedBooks.has(idStr)) {
        matchedBooks.get(idStr).score += 1.0;
      } else {
        let score = 1.0;
        const cleanCode = (b.code || '').replace(/[^\w\d]/g, '').toLowerCase();
        const cleanIsbn = (b.isbn || '').replace(/[^\w\d]/g, '').toLowerCase();
        
        if (cleanCode === cleanQueryStr) score += 5.0;
        if (cleanIsbn === cleanQueryStr) score += 5.0;
        
        const lowerQ = cleanQ.toLowerCase();
        if (b.title && b.title.toLowerCase().includes(lowerQ)) score += 2.0;
        
        matchedBooks.set(idStr, {
          doc: b,
          score: score
        });
      }
    });

    textDocs.forEach(d => {
      matchedDocs.set(d._id.toString(), {
        doc: d,
        score: d._doc.score || 1.0
      });
    });

    regexDocs.forEach(d => {
      const idStr = d._id.toString();
      if (matchedDocs.has(idStr)) {
        matchedDocs.get(idStr).score += 1.0;
      } else {
        let score = 1.0;
        const cleanOriginalName = (d.originalName || '').replace(/[^\w\d]/g, '').toLowerCase();
        
        if (cleanOriginalName === cleanQueryStr) score += 5.0;
        
        const lowerQ = cleanQ.toLowerCase();
        const docTitle = d.title || d.originalName || '';
        if (docTitle.toLowerCase().includes(lowerQ)) score += 2.0;
        
        matchedDocs.set(idStr, {
          doc: d,
          score: score
        });
      }
    });

    // Format combined search results
    const results = [];

    matchedBooks.forEach((item) => {
      const b = item.doc;
      results.push({
        entity_type: 'book',
        entity_id: b._id,
        title: b.title,
        snippet: makeSnippet(b.description || b.excerpt || '', cleanQ),
        rank: -item.score
      });
    });

    matchedDocs.forEach((item) => {
      const d = item.doc;
      results.push({
        entity_type: 'document',
        entity_id: d._id,
        title: d.title || d.originalName,
        snippet: makeSnippet(d.extractedText || d.notes || '', cleanQ),
        rank: -item.score
      });
    });

    results.sort((a, b) => a.rank - b.rank);
    res.json(results.slice(0, 50));
  } catch (err) {
    console.error('Lỗi tìm kiếm:', err);
    res.json([]);
  }
});

// -------------------------------------------------------------
// DASHBOARD & ADMIN ROUTING
// -------------------------------------------------------------
app.get('/api/dashboard', auth, requirePermission('reports.view_basic'), async (req, res) => {
  try {
    const [booksCount, customersCount, ordersCount, docsCount] = await Promise.all([
      Book.countDocuments(),
      Customer.countDocuments(),
      Order.countDocuments(),
      Document.countDocuments()
    ]);

    // Calculate revenue using aggregation
    const revRes = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
    const revenue = revRes[0] ? revRes[0].total : 0;

    const lowStockCount = await Book.countDocuments({ stockQuantity: { $lte: 3 } });
    const lowStock = await Book.find({ stockQuantity: { $lte: 3 } }).sort({ stockQuantity: 1 }).limit(10);

    // Calculate top-selling books
    const topBooks = await Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.bookId', title: { $first: '$items.bookTitle' }, qty: { $sum: '$items.quantity' }, revenue: { $sum: '$items.total' } } },
      { $sort: { qty: -1, revenue: -1 } },
      { $limit: 10 }
    ]);

    // Document types distribution
    const docTypes = await Document.aggregate([
      { $group: { _id: '$docType', count: { $sum: 1 } } }
    ]);

    // Document MIME distribution
    const mimeTypes = await Document.aggregate([
      { $group: { _id: '$mimeType', count: { $sum: 1 } } }
    ]);

    // OCR status distribution
    const ocrStatus = await Document.aggregate([
      { $group: { _id: '$ocrStatus', count: { $sum: 1 } } }
    ]);

    // Calculate total document size
    const sizeRes = await Document.aggregate([
      { $group: { _id: null, size: { $sum: '$size' } } }
    ]);
    const totalSize = sizeRes[0] ? sizeRes[0].size : 0;

    res.json({
      totals: {
        books: booksCount,
        customers: customersCount,
        orders: ordersCount,
        documents: docsCount,
        revenue,
        lowStock: lowStockCount
      },
      lowStock: lowStock.map(b => ({ code: b.code, title: b.title, stock_quantity: b.stockQuantity })),
      topBooks: topBooks.map(t => ({ title: t.title, qty: t.qty, revenue: t.revenue })),
      documentTypes: docTypes.map(d => ({ doc_type: d._id, count: d.count })),
      unstructuredStats: {
        totalDocs: docsCount,
        totalSize,
        mimeDistribution: mimeTypes.map(m => ({ mime_type: m._id, count: m.count })),
        ocrStatusDistribution: ocrStatus.map(o => ({ ocr_status: o._id, count: o.count })),
        docTypeDistribution: docTypes.map(d => ({ doc_type: d._id, count: d.count }))
      }
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/reports/export/:type', auth, requirePermission('reports.view_basic','reports.view_financial'), async (req, res) => {
  const type = req.params.type;
  const format = req.query.format || 'csv';

  try {
    let data = [];
    if (type === 'books') {
      const list = await Book.find({}).sort({ code: 1 });
      data = list.map(b => ({
        id: b._id.toString(),
        code: b.code,
        title: b.title,
        author: b.author || '',
        category: b.category || '',
        publisher: b.publisher || '',
        isbn: b.isbn || '',
        sale_price: b.salePrice,
        stock_quantity: b.stockQuantity,
        created_at: b.createdAt
      }));
    } else if (type === 'customers') {
      const list = await Customer.find({});
      data = list.map(c => ({
        id: c._id.toString(),
        fullName: c.fullName,
        phone: c.phone || '',
        email: c.email || '',
        type: c.type,
        notes: c.notes || '',
        createdAt: c.createdAt
      }));
    } else if (type === 'orders') {
      const list = await Order.find({}).sort({ createdAt: -1 });
      data = list.map(o => ({
        id: o._id.toString(),
        orderCode: o.orderCode,
        customerName: o.customerName || 'Khách lẻ',
        status: o.status,
        paymentMethod: o.paymentMethod,
        subtotal: o.subtotal,
        discount: o.discount,
        tax: o.tax,
        total: o.total,
        notes: o.notes || '',
        createdAt: o.createdAt
      }));
    } else if (type === 'inventory') {
      const list = await Book.find({});
      data = list.map(b => ({
        book_id: b._id.toString(),
        code: b.code,
        title: b.title,
        stock_quantity: b.stockQuantity,
        import_price: b.importPrice,
        sale_price: b.salePrice,
        category: b.category || ''
      }));
    } else if (type === 'documents') {
      const list = await Document.find({}).sort({ createdAt: -1 });
      data = list.map(d => ({
        id: d._id.toString(),
        originalName: d.originalName,
        mimeType: d.mimeType,
        size: d.size,
        docType: d.docType,
        entityType: d.entityType || '',
        entityId: d.entityId ? d.entityId.toString() : '',
        title: d.title,
        ocrStatus: d.ocrStatus,
        createdAt: d.createdAt
      }));
    } else if (type === 'slips') {
      const list = await InventorySlip.find({}).sort({ createdAt: -1 });
      const mapped = [];
      for (const sl of list) {
        const u = await User.findById(sl.createdBy);
        const sup = sl.supplierId ? await Supplier.findById(sl.supplierId) : null;
        mapped.push({
          id: sl._id.toString(),
          slipCode: sl.slipCode,
          type: sl.type,
          supplierName: sup ? sup.name : 'Điều chỉnh kho',
          createdBy: u ? u.fullName : 'Hệ thống',
          status: sl.status,
          createdAt: sl.createdAt
        });
      }
      data = mapped;
    } else {
      return res.status(404).json({ error: 'Loại report không hỗ trợ' });
    }

    const filename = `${type}_report_${Date.now()}`;
    if (format === 'excel' || format === 'xlsx') {
      excel(res, filename + '.xlsx', data);
    } else {
      csv(res, filename + '.csv', data);
    }
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

const ALL_PERMISSIONS = [
  'books.view','books.create','books.update','books.delete',
  'customers.view','customers.view_all','customers.create','customers.update','customers.delete',
  'orders.view','orders.view_all','orders.create','orders.update','orders.cancel',
  'inventory.view','inventory.import','inventory.export','inventory.adjust',
  'suppliers.view','suppliers.create','suppliers.update','suppliers.delete',
  'documents.view','documents.view_all','documents.upload','documents.update','documents.delete',
  'search.use','reports.view_basic','reports.view_financial',
  'users.view','users.create','users.update','users.delete',
  'roles.manage','audit_logs.view','settings.manage'
];

function getPermissionId(code) {
  const idx = ALL_PERMISSIONS.indexOf(code);
  return idx !== -1 ? idx + 1 : null;
}

function getPermissionCode(id) {
  const idx = Number(id) - 1;
  return (idx >= 0 && idx < ALL_PERMISSIONS.length) ? ALL_PERMISSIONS[idx] : null;
}

app.get('/api/roles', auth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const list = await Role.find({}).sort({ name: 1 });
    res.json(list.map(r => ({
      id: r._id,
      name: r.name,
      description: r.description || '',
      permissions: r.permissions.map(p => ({
        id: getPermissionId(p),
        code: p,
        description: p
      }))
    })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/permissions', auth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const list = ALL_PERMISSIONS.map(code => ({
      id: getPermissionId(code),
      code,
      description: code
    }));
    res.json(list);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/roles/:id/permissions', auth, requirePermission('roles.manage'), async (req, res) => {
  try {
    const r = await Role.findById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy vai trò' });
    
    const body = z.object({ permission_ids: z.array(z.any()) }).parse(req.body);
    
    // Map IDs back to codes
    const newPermCodes = body.permission_ids
      .map(id => getPermissionCode(id))
      .filter(Boolean);
    
    r.permissions = newPermCodes;
    await r.save();
    
    await audit(req.user.id, 'update_permissions', 'role', r._id, { permission_ids: body.permission_ids });
    
    res.json({
      role: {
        id: r._id,
        name: r.name,
        description: r.description || ''
      },
      permissions: r.permissions.map(p => ({
        id: getPermissionId(p),
        code: p,
        description: p
      }))
    });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/users', auth, requirePermission('users.view'), async (req, res) => {
  try {
    const list = await User.find({}).sort({ _id: 1 });
    res.json(list.map(u => ({
      id: u._id,
      full_name: u.fullName,
      email: u.email,
      is_active: u.isActive ? 1 : 0,
      created_at: u.createdAt,
      role: u.role,
      role_id: u.role
    })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/users', auth, requirePermission('users.create'), async (req, res) => {
  try {
    const s = z.object({ full_name: z.string().min(1), email: z.string().email(), password: z.string().min(6), role_id: z.any(), is_active: z.number().optional() }).parse(req.body);
    
    let roleName = 'sales';
    if (typeof s.role_id === 'string') roleName = s.role_id;
    else {
      const rObj = await Role.findById(s.role_id);
      if (rObj) roleName = rObj.name;
    }

    const u = new User({
      _id: await getNextId(User),
      fullName: s.full_name,
      email: s.email,
      passwordHash: bcrypt.hashSync(s.password, 10),
      role: roleName,
      isActive: (s.is_active ?? 1) === 1
    });
    await u.save();
    
    await audit(req.user.id, 'create', 'user', u._id, { email: s.email, role: roleName });
    res.status(201).json({ id: u._id, full_name: u.fullName, email: u.email });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/users/:id', auth, requirePermission('users.update'), async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Không tìm thấy user' });

    let roleName = u.role;
    if (req.body.role_id) {
      if (typeof req.body.role_id === 'string') roleName = req.body.role_id;
      else {
        const rObj = await Role.findById(req.body.role_id);
        if (rObj) roleName = rObj.name;
      }
    }

    u.fullName = req.body.full_name !== undefined ? req.body.full_name : u.fullName;
    u.email = req.body.email !== undefined ? req.body.email : u.email;
    u.passwordHash = req.body.password ? bcrypt.hashSync(req.body.password, 10) : u.passwordHash;
    u.role = roleName;
    u.isActive = req.body.is_active !== undefined ? (req.body.is_active === 1) : u.isActive;
    await u.save();

    await audit(req.user.id, 'update', 'user', u._id, { email: u.email, role: u.role });
    res.json({ id: u._id, full_name: u.fullName });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/users/:id', auth, requirePermission('users.delete'), async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'Không thể tự khóa tài khoản của chính mình' });
    }
    const u = await User.findByIdAndUpdate(req.params.id, { isActive: false });
    if (!u) return res.status(404).json({ error: 'Không tìm thấy user' });
    await audit(req.user.id, 'deactivate', 'user', req.params.id);
    res.json({ ok: true });
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// ── SystemLog APIs (log có cấu trúc trên MongoDB) ──
app.get('/api/system-logs', auth, requirePermission('audit.view'), async (req, res) => {
  try {
    const q = req.query.q || '';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const filter = {};
    if (q) {
      filter.$or = [
        { userName: { $regex: q, $options: 'i' } },
        { action: { $regex: q, $options: 'i' } },
        { entityType: { $regex: q, $options: 'i' } },
        { details: { $regex: q, $options: 'i' } }
      ];
    }
    const list = await SystemLog.find(filter).sort({ timestamp: -1 }).limit(limit);
    res.json(list.map(l => ({
      id: l._id,
      timestamp: l.timestamp,
      user_name: l.userName,
      action: l.action,
      entity_type: l.entityType || '',
      entity_id: l.entityId || '',
      details: l.details || ''
    })));
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/audit-logs', auth, requirePermission('audit.view'), async (req, res) => {
  try {
    const list = await AuditLog.find({}).sort({ createdAt: -1 }).limit(200);
    const mapped = [];
    for (const l of list) {
      const u = await User.findById(l.userId);
      mapped.push({
        id: l._id,
        created_at: l.createdAt,
        user_name: u ? u.fullName : 'Hệ thống',
        action: l.action,
        entity_type: l.entityType || '',
        entity_id: l.entityId ? l.entityId.toString() : ''
      });
    }
    res.json(mapped);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

// ── AI Book Management Session Store ──
const bookSessions = new Map();
function getBookSession(userId) {
  const s = bookSessions.get(userId);
  if (s && Date.now() - s.updatedAt > 600000) { bookSessions.delete(userId); return null; }
  return s;
}
function setBookSession(userId, data) { bookSessions.set(userId, { ...data, updatedAt: Date.now() }); }
function clearBookSession(userId) { bookSessions.delete(userId); }

function money(v) { return new Intl.NumberFormat('vi-VN').format(v||0) + 'đ'; }

async function executeCreateBook(req, res, session) {
  const info = session.bookInfo;
  const bookId = await getNextId(Book);
  const code = 'BOOK-' + String(bookId).padStart(3, '0');
  const importPrice = info.import_price || 0;
  const salePrice = info.sale_price || 0;

  const book = new Book({
    _id: bookId,
    code,
    title: info.title,
    author: info.author || null,
    category: info.category || null,
    publisher: info.publisher || null,
    isbn: info.isbn || null,
    publishedYear: info.published_year || null,
    pages: info.pages || null,
    language: info.language || 'vi',
    importPrice,
    salePrice,
    stockQuantity: 0,
    description: info.description || null,
    isActive: true
  });
  await book.save();
  
  await audit(req.user.id, 'create', 'book', book._id, { title: info.title, source: 'ai_chat' });
  clearBookSession(req.user.id);
  res.json({
    answer: '✅ Đã thêm sách **' + info.title + '** vào thư viện thành công!\nMã sách: ' + code + '\nGiá nhập: ' + money(importPrice) + ' | Giá bán: ' + money(salePrice) + '\nBạn có thể xem trong tab Sách nhé.',
    sources: [],
    action: 'create_success',
    book: {
      id: book._id,
      code: book.code,
      title: book.title,
      author: book.author,
      sale_price: book.salePrice,
      stock_quantity: book.stockQuantity,
      is_active: book.isActive ? 1 : 0
    }
  });
}

async function executeToggleActive(req, res, session) {
  const val = session.actionValue;
  const book = await Book.findById(session.bookId);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });
  
  book.isActive = val === 1;
  book.updatedAt = new Date();
  await book.save();

  await audit(req.user.id, 'update', 'book', book._id, { is_active: val, source: 'ai_chat' });
  clearBookSession(req.user.id);
  const label = val ? 'mở bán lại' : 'ngưng bán';
  res.json({ answer: '✅ Đã ' + label + ' sách **' + session.bookTitle + '** thành công!', sources: [], action: 'toggle_success' });
}

async function executeAdjustPrice(req, res, session) {
  const book = await Book.findById(session.bookId);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });
  
  book.salePrice = session.newPrice;
  book.updatedAt = new Date();
  await book.save();

  await audit(req.user.id, 'update', 'book', book._id, { sale_price: session.newPrice, old_price: session.oldPrice, source: 'ai_chat' });
  clearBookSession(req.user.id);
  res.json({ answer: '✅ Đã cập nhật giá sách **' + session.bookTitle + '**: ' + money(session.oldPrice) + ' → ' + money(session.newPrice), sources: [], action: 'price_success' });
}

async function executeAdjustStock(req, res, session) {
  const book = await Book.findById(session.bookId);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });
  
  const delta = session.actionValue === 'out' ? -session.quantity : session.quantity;
  book.stockQuantity += delta;
  book.updatedAt = new Date();
  await book.save();

  const lastSlip = await InventorySlip.findOne({}).sort({ slipCode: -1 }).select('slipCode');
  let lastNum = 0;
  if (lastSlip && lastSlip.slipCode && lastSlip.slipCode.startsWith('SLIP-')) {
    lastNum = parseInt(lastSlip.slipCode.replace('SLIP-', '')) || 0;
  }
  const slipCode = 'SLIP-' + String(lastNum + 1).padStart(3, '0');

  const slip = new InventorySlip({
    _id: await getNextId(InventorySlip),
    slipCode,
    type: session.actionValue === 'out' ? 'out' : 'in',
    note: 'AI Chat adjustment',
    createdBy: req.user.id,
    items: [{
      bookId: book._id,
      bookCode: book.code,
      bookTitle: book.title,
      quantity: Math.abs(delta),
      unitCost: book.importPrice || 0,
      note: 'AI Chat adjustment'
    }]
  });
  await slip.save();

  await audit(req.user.id, 'update', 'book', book._id, { stock_delta: delta, source: 'ai_chat' });
  const newStock = session.oldStock + delta;
  clearBookSession(req.user.id);
  res.json({ answer: '✅ Đã ' + (session.actionValue === 'out' ? 'xuất' : 'nhập') + ' ' + session.quantity + ' cuốn **' + session.bookTitle + '**.\nTồn kho: ' + session.oldStock + ' → ' + newStock + ' cuốn.', sources: [], action: 'stock_success' });
}

async function executeUpdateInfo(req, res, session) {
  const field = session.field;
  const book = await Book.findById(session.bookId);
  if (!book) return res.json({ answer: 'Không tìm thấy sách.', sources: [] });

  const validFields = { title: 1, description: 1, isbn: 1, excerpt: 1 };
  if (!validFields[field]) return res.json({ answer: 'Không thể cập nhật trường "' + field + '".', sources: [] });

  book[field] = session.value;
  book.updatedAt = new Date();
  await book.save();

  await audit(req.user.id, 'update', 'book', book._id, { field: field, value: session.value, source: 'ai_chat' });
  clearBookSession(req.user.id);
  res.json({ answer: '✅ Đã cập nhật ' + field + ' của sách **' + session.bookTitle + '** thành công!', sources: [], action: 'update_success' });
}

// ── Log File APIs (Dữ liệu phi cấu trúc) ──

async function formatLogDoc(log) {
  const time = log.createdAt ? log.createdAt.toISOString().slice(11, 19) : '00:00:00';
  const actionLabels = {
    create: 'Tạo mới', update: 'Cập nhật', delete: 'Xóa', upload: 'Tải lên', download: 'Tải xuống',
    login: 'Đăng nhập', logout: 'Đăng xuất', cancel: 'Hủy', reprocess: 'Xử lý lại OCR',
    ai_classify: 'AI phân loại', ai_summarize: 'AI tóm tắt', update_status: 'Cập nhật trạng thái',
    update_permissions: 'Cập nhật quyền', deactivate: 'Vô hiệu hóa'
  };
  const entityLabels = {
    book: 'Sách', customer: 'Khách hàng', order: 'Đơn hàng', supplier: 'Nhà cung cấp',
    document: 'Tài liệu', inventory_slip: 'Phiếu kho', inventory_transaction: 'Giao dịch kho',
    user: 'Người dùng', role: 'Vai trò'
  };
  
  const actionLabel = actionLabels[log.action] || log.action;
  const entityLabel = entityLabels[log.entityType] || log.entityType;
  
  const u = log.userId ? await User.findById(log.userId) : null;
  const who = u ? `${u.fullName} <${u.email || ''}>` : 'system';
  
  let detailStr = '';
  try {
    const d = JSON.parse(log.details || '{}');
    const interesting = [];
    if (d.title) interesting.push(`"${d.title}"`);
    if (d.code) interesting.push(`mã: ${d.code}`);
    if (d.original_name) interesting.push(`file: ${d.original_name}`);
    if (d.doc_type) interesting.push(`loại: ${d.doc_type}`);
    if (d.order_code) interesting.push(`đơn: ${d.order_code}`);
    if (d.status) interesting.push(`trạng thái: ${d.status}`);
    if (d.email) interesting.push(`email: ${d.email}`);
    if (d.reason) interesting.push(`lý do: ${d.reason}`);
    if (interesting.length > 0) detailStr = ' | ' + interesting.join(', ');
  } catch {}
  const entityStr = log.entityType ? `${entityLabel}` + (log.entityId ? ` #${log.entityId}` : '') : '';
  return `[${time}] ${who} | ${actionLabel} | ${entityStr}${detailStr}`;
}

async function backfillTodayLogMongo() {
  // No-op: we do not write log files to hard drive anymore
}

app.get('/api/logs', auth, requirePermission('audit.view'), async (req, res) => {
  try {
    // Group AuditLogs by date (YYYY-MM-DD)
    const logsGrouped = await AuditLog.aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
          lastModified: { $max: "$createdAt" }
        }
      },
      { $sort: { _id: -1 } }
    ]);
    
    const files = logsGrouped.map(l => {
      const date = l._id;
      const virtualSize = l.count * 150; // estimate size of 150 bytes per line
      return {
        filename: `${date}.log`,
        date,
        size: virtualSize,
        sizeKB: (virtualSize / 1024).toFixed(1),
        lines: l.count,
        created_at: new Date(date + 'T00:00:00.000Z'),
        modified_at: l.lastModified
      };
    });
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs/range/export', auth, requirePermission('audit.view'), async (req, res) => {
  const { from, to, format } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'Cần truyền from và to (YYYY-MM-DD)' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });
  const fromD = new Date(from);
  const toD = new Date(to);
  if (toD < fromD) return res.status(400).json({ error: '"to" phải sau hoặc bằng "from"' });
  const diffDays = (toD - fromD) / (1000 * 60 * 60 * 24);
  if (diffDays > 90) return res.status(400).json({ error: 'Khoảng thời gian tối đa là 90 ngày' });

  const start = new Date(from + 'T00:00:00.000Z');
  const end = new Date(to + 'T23:59:59.999Z');
  const list = await AuditLog.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: 1 });

  if (format === 'csv' || format === 'xlsx') {
    const rows = [];
    for (const l of list) {
      const u = l.userId ? await User.findById(l.userId) : null;
      rows.push({
        'Thời gian': l.createdAt.toISOString(),
        'Người dùng': u ? u.fullName : 'system',
        'Email': u ? u.email : '',
        'Hành động': l.action,
        'Đối tượng': l.entityType || '',
        'ID đối tượng': l.entityId ? l.entityId.toString() : '',
        'Chi tiết': l.details || ''
      });
    }
    const filename = `activity-log-${from}-to-${to}`;
    if (format === 'xlsx') return excel(res, filename + '.xlsx', rows);
    return csv(res, filename + '.csv', rows);
  }

  const lines = await Promise.all(list.map(log => formatLogDoc(log)));
  const content = lines.join('\n') + '\n';
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="activity-log-${from}-to-${to}.log"`);
  res.send(content);
});

app.get('/api/logs/:date', auth, requirePermission('audit.view'), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ (YYYY-MM-DD)' });
  try {
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');
    
    const logs = await AuditLog.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: 1 });
    const lines = await Promise.all(logs.map(log => formatLogDoc(log)));
    
    const keyword = req.query.q || '';
    if (!keyword) {
      return res.json({ date, lines, total: lines.length });
    }
    const kw = keyword.toLowerCase();
    const filteredLines = lines.filter(l => l.toLowerCase().includes(kw));
    res.json({ date, lines: filteredLines, total: filteredLines.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs/:date/download', auth, requirePermission('audit.view'), async (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Định dạng ngày không hợp lệ' });
  try {
    const start = new Date(date + 'T00:00:00.000Z');
    const end = new Date(date + 'T23:59:59.999Z');
    
    const logs = await AuditLog.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: 1 });
    const lines = await Promise.all(logs.map(log => formatLogDoc(log)));
    const content = lines.join('\n') + '\n';
    
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="activity-${date}.log"`);
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Report Storage APIs (Dữ liệu lưu MongoDB) ──

app.get('/api/reports', auth, requirePermission('reports.view_basic'), async (req, res) => {
  try {
    const list = await Report.find({}, { fileData: 0 }).sort({ createdAt: -1 });
    res.json(list.map(r => ({
      id: r._id,
      title: r.title,
      fileName: r.fileName,
      fileType: r.fileType,
      fileSizeKB: r.fileSizeKB,
      uploadedBy: r.uploadedBy,
      notes: r.notes,
      created_at: r.createdAt
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reports', auth, requirePermission('reports.view_financial'), memoryUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Không tìm thấy file tải lên' });
    const notes = req.body.notes || '';
    const title = req.body.title || req.file.originalname;
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const validExts = ['csv', 'xlsx', 'pdf', 'txt'];
    if (!validExts.includes(ext)) {
      return res.status(400).json({ error: 'Định dạng file không được hỗ trợ. Cần: csv, xlsx, pdf, txt' });
    }
    const report = new Report({
      _id: await getNextId(Report),
      title,
      fileName: req.file.originalname,
      fileType: ext,
      fileSizeKB: Math.round(req.file.size / 1024),
      fileData: req.file.buffer,
      uploadedBy: req.user.fullName,
      notes
    });
    await report.save();
    await audit(req.user.id, 'upload', 'report', report._id, { title, fileName: req.file.originalname });
    res.status(201).json({ id: report._id, title: report.title });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/reports/:id/download', auth, requirePermission('reports.view_basic'), async (req, res) => {
  try {
    const r = await Report.findById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    const mimeTypes = {
      pdf: 'application/pdf',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain'
    };
    const mime = mimeTypes[r.fileType] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(r.fileName)}"`);
    res.send(r.fileData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Report preview as JSON (base64-encoded fileData for in-browser preview)
app.get('/api/reports/:id/preview', auth, requirePermission('reports.view_basic'), async (req, res) => {
  try {
    const r = await Report.findById(req.params.id);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    const mimeTypes = {
      pdf: 'application/pdf',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv',
      txt: 'text/plain'
    };
    res.json({
      id: r._id,
      title: r.title,
      fileName: r.fileName,
      fileType: r.fileType,
      fileSizeKB: r.fileSizeKB,
      contentType: mimeTypes[r.fileType] || 'application/octet-stream',
      fileData: r.fileData ? r.fileData.toString('base64') : null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/reports/:id', auth, requirePermission('reports.view_financial'), async (req, res) => {
  try {
    const r = await Report.findByIdAndDelete(req.params.id);
    if (!r) return res.status(404).json({ error: 'Không tìm thấy báo cáo' });
    await audit(req.user.id, 'delete', 'report', r._id, { title: r.title });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Customer Feedback APIs (MongoDB Storage & Sentiment Analysis) ──
app.get('/api/feedbacks', async (req, res) => {
  try {
    const { bookId, customerId, sentiment, status, rating, isFeatured, page = 1, limit = 20 } = req.query;
    
    // Auth check: allow if token is valid (either User or Customer) or if public book reviews query
    const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
    let isAuthorized = false;
    if (token) {
      try {
        const verified = jwt.verify(token, JWT_SECRET);
        if (verified.type === 'customer') {
          isAuthorized = true;
        } else {
          const userObj = await User.findById(verified.id);
          if (userObj && userObj.isActive) {
            isAuthorized = true;
          }
        }
      } catch (e) {}
    }
    
    // If not authorized, only allow if filtering by a specific bookId
    if (!isAuthorized && !bookId) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập dữ liệu này.' });
    }

    const filter = {};
    if (bookId) filter.bookId = Number(bookId);
    if (customerId) filter.customerId = Number(customerId);
    if (sentiment) filter.sentiment = sentiment;
    if (status) filter.status = status;
    if (rating) filter.rating = Number(rating);
    if (isFeatured !== undefined) filter.isFeatured = isFeatured === 'true';
    
    const count = await Feedback.countDocuments(filter);
    // Sort: negative first, neutral middle, positive last, then by newest
    const list = await Feedback.find(filter)
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));
    
    // Sort in-memory by sentiment priority (negative→neutral→positive), then featured, then date
    const sentimentOrder = { negative: 0, neutral: 1, positive: 2 };
    const sortedList = list.toObject ? list : list;
    const sorted = [...list].sort((a, b) => {
      const sa = sentimentOrder[a.sentiment] ?? 1;
      const sb = sentimentOrder[b.sentiment] ?? 1;
      if (sa !== sb) return sa - sb;
      if (a.isFeatured !== b.isFeatured) return a.isFeatured ? -1 : 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
      
    const mapped = sorted.map(f => ({
      id: f._id,
      bookId: f.bookId,
      customerId: f.customerId,
      customerName: f.customerName,
      email: f.email,
      rating: f.rating,
      comment: f.comment,
      tags: f.tags,
      sentiment: f.sentiment,
      score: f.score,
      isFeatured: f.isFeatured,
      status: f.status,
      createdAt: f.createdAt,
      media: (f.media || []).map((m, idx) => ({
        fileName: m.fileName,
        fileType: m.fileType,
        fileSizeKB: m.fileSizeKB,
        url: `/api/feedbacks/media/${f._id}/${idx}`
      }))
    }));
    
    res.json({ list: mapped, total: count, page: Number(page), pages: Math.ceil(count / Number(limit)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/feedbacks/media/:id/:index', async (req, res) => {
  try {
    const f = await Feedback.findById(req.params.id);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy feedback' });
    const idx = Number(req.params.index);
    if (!f.media || !f.media[idx]) return res.status(404).json({ error: 'Không tìm thấy hình ảnh đính kèm' });
    const img = f.media[idx];
    res.setHeader('Content-Type', img.fileType || 'image/jpeg');
    res.send(img.fileData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/feedbacks', memoryUpload.array('images', 5), async (req, res) => {
  try {
    const { rating, comment, customer_name, email, customer_id, book_id, tags_json } = req.body;
    if (!rating || !comment || !customer_name) {
      return res.status(400).json({ error: 'Thiếu thông tin đánh giá (rating, comment, customer_name)' });
    }
    
    let tags = [];
    try {
      if (tags_json) tags = JSON.parse(tags_json);
    } catch {}
    if (!Array.isArray(tags) && typeof tags_json === 'string') {
      tags = tags_json.split(',').map(x => x.trim()).filter(Boolean);
    }
    
    const mappedMedia = [];
    if (req.files && req.files.length) {
      for (const file of req.files) {
        // [FIX 5] Validate per-image size: tối đa 2MB/ảnh để tránh vượt 16MB BSON limit
        if (file.size > 2 * 1024 * 1024) {
          return res.status(400).json({ error: 'Mỗi ảnh không được quá 2MB: ' + file.originalname });
        }
        mappedMedia.push({
          fileName: file.originalname,
          fileType: file.mimetype,
          fileSizeKB: Math.round(file.size / 1024),
          fileData: file.buffer
        });
      }
    }
    
    // AI Sentiment Analysis
    const sentimentResult = await aiService.analyzeFeedbackSentiment(comment);
    const isPositive = sentimentResult.sentiment === 'positive';
    const isFeatured = isPositive && sentimentResult.score >= 0.8 && Number(rating) >= 4;
    
    const feedback = new Feedback({
      _id: await getNextId(Feedback),
      bookId: book_id ? Number(book_id) : null,
      customerId: customer_id ? Number(customer_id) : null,
      customerName: customer_name,
      email: email || null,
      rating: Number(rating),
      comment,
      tags,
      media: mappedMedia,
      sentiment: sentimentResult.sentiment,
      score: sentimentResult.score,
      isFeatured,
      status: 'new'
    });
    
    await feedback.save();
    res.status(201).json({ id: feedback._id, sentiment: feedback.sentiment, isFeatured: feedback.isFeatured });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/feedbacks/:id/feature', auth, requirePermission('books.update'), async (req, res) => {
  try {
    const f = await Feedback.findById(req.params.id);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy phản hồi' });
    const { isFeatured } = req.body;
    if (isFeatured !== undefined) {
      f.isFeatured = !!isFeatured;
      await f.save();
      await audit(req.user.id, 'update_status', 'feedback', f._id, { isFeatured: f.isFeatured });
    }
    res.json(f);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.patch('/api/feedbacks/:id/status', auth, requirePermission('books.update'), async (req, res) => {
  try {
    const f = await Feedback.findById(req.params.id);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy phản hồi' });
    const { status } = req.body;
    const validStatuses = ['new', 'reviewed', 'resolved', 'urgent'];
    if (status && validStatuses.includes(status)) {
      f.status = status;
      await f.save();
      await audit(req.user.id, 'update_status', 'feedback', f._id, { status: f.status });
    }
    res.json(f);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/feedbacks/:id', auth, requirePermission('books.update'), async (req, res) => {
  try {
    const f = await Feedback.findByIdAndDelete(req.params.id);
    if (!f) return res.status(404).json({ error: 'Không tìm thấy phản hồi' });
    await audit(req.user.id, 'delete', 'feedback', f._id, { customerName: f.customerName });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI endpoints ──

app.post('/api/ai/classify/:id', auth, requirePermission('documents.update'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    if (!d.extractedText) return res.status(400).json({ error: 'Tài liệu chưa được trích xuất văn bản' });
    
    const result = await aiService.classifyDocument(d.extractedText);
    d.docType = result.type;
    d.updatedAt = new Date();
    
    if (!d.metadata) d.metadata = new Map();
    d.metadata.set('aiConfidence', String(result.confidence));
    d.metadata.set('aiClassifiedAt', new Date().toISOString());
    await d.save();

    await audit(req.user.id, 'ai_classify', 'document', d._id, { from: d.docType, to: result.type, confidence: result.confidence });
    res.json({ document_id: d._id, doc_type: result.type, confidence: result.confidence, previous: d.docType });
  } catch (e) {
    res.status(500).json({ error: 'AI classification thất bại: ' + e.message });
  }
});

app.post('/api/ai/summarize/:id', auth, requirePermission('documents.update'), async (req, res) => {
  try {
    const d = await Document.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Không tìm thấy tài liệu' });
    const text = d.extractedText || d.notes;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Tài liệu không có nội dung để tóm tắt' });

    const result = await aiService.summarizeDocument(text);
    const now = new Date().toISOString();
    
    if (!d.metadata) d.metadata = new Map();
    d.metadata.set('ai_summary', result.summary);
    d.metadata.set('ai_summarized_at', now);
    await d.save();

    await audit(req.user.id, 'ai_summarize', 'document', d._id);
    res.json({ document_id: d._id, summary: result.summary, summarized_at: now });
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

    // [FIX 2] Tim sach: uu tien title match nhieu tu nhat
    let dbBooks = [];
    if (words.length >= 1) {
      const anyRegex = words.map(w => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      dbBooks = await Book.find({
        $or: [
          { title: { $in: anyRegex } },
          { author: { $in: anyRegex } }
        ]
      }).limit(5);
      // Sap xep: sach co title chua cau hoi goc len dau
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
    // [FIX 1] Clear stale session nếu user bắt đầu flow mới (không phải confirm/từ chối)
    if (session && session.step !== 'done') {
      const newFlow = /^(thêm|nhập|tạo|add\s+book|tăng\s+giá|giảm\s+giá|ngưng\s+bán|ngừng\s+bán|sửa\s+mô\s+tả|nhập\s+thêm|xuất\s+kho|mở\s+bán)\b/i.test(question.trim());
      if (newFlow) {
        clearBookSession(req.user.id);
        session = null;
      }
    }
    const wasWarned = (history || []).some(m => m.role === 'assistant' && (m.content.toLowerCase().includes('đừng hỏi lung tung') || m.content.includes('Đã bảo tốn token')));

    const hasBookMgmtKeyword = /thêm|nhập|tạo|ngưng|ngừng|dừng|ẩn|gỡ|xóa|mở bán|kích hoạt|cho lên|tăng giá|giảm giá|hạ giá|up giá|sale giá|nhập thêm|xuất kho|tồn|sửa|đổi|cập nhật|chỉnh|điều chỉnh|được|ok|oke|okey|ừ|duyệt|chốt|thực hiện|làm đi|add book|hủy|không|bỏ|thôi/i;
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
      // Map format for LLM intent parsing
      const mappedDbBooks = dbBooks.map(b => ({
        id: b._id.toString(),
        code: b.code,
        title: b.title,
        author: b.author,
        sale_price: b.salePrice,
        stock_quantity: b.stockQuantity,
        is_active: b.isActive ? 1 : 0,
        description: b.description
      }));
      
      const intent = await aiService.parseBookIntent(processedQuestion, mappedDbBooks, session);

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
        const bookId = dbBooks.length > 0 ? dbBooks[0]._id.toString() : null;
        if (bookId) {
          intent.intent = 'toggle_active';
          intent.book_id = bookId;
          intent.action = 'activate';
        }
      }

      if ((intent.intent === 'adjust_price' || intent.intent === 'adjust_stock' || intent.intent === 'toggle_active' || intent.intent === 'update_info') && !intent.book_id && dbBooks.length > 0) {
        intent.book_id = dbBooks[0]._id.toString();
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
        // [FIX 4] Strict confirm: chỉ match khi câu ngắn (<50) và chỉ chứa confirm keyword, KHÔNG match 'thêm' trong câu dài
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
        const bookInfo = await aiService.lookupBookInfo(intent.book_name);
        if (bookInfo.error) {
          return res.json({ answer: 'Không tìm thấy thông tin sách "' + intent.book_name + '". Bạn thử tên khác nhé.', sources: [], action: 'error' });
        }
        setBookSession(req.user.id, { step: 'awaiting_price', bookInfo: bookInfo, pendingAction: 'create_book' });
        return res.json({ answer: intent.message + '\n\n📖 **' + bookInfo.title + '**\n✍️ ' + (bookInfo.author || 'Chưa rõ') + '\n💰 Giá tham khảo: ' + (bookInfo.estimated_price ? money(bookInfo.estimated_price) : 'Chưa có') + '\n\nBạn muốn nhập giá bao nhiêu? (nhập 1 số, VD: 90000 hoặc 90k)', sources: [], action: 'search_result', book_info: bookInfo });
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
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0]._id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này trong hệ thống.', sources: [] });
        const book = await Book.findById(bookId);
        const actionVerb = intent.action === 'activate' ? 'mở bán lại' : 'ngưng bán';
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'toggle_active', actionValue: intent.action === 'activate' ? 1 : 0, actionLabel: actionVerb, bookTitle: book.title });
        return res.json({ answer: intent.message || ('Bạn muốn ' + actionVerb + ' sách "' + book.title + '" (đang ' + (book.isActive ? 'bán' : 'ngưng bán') + ', tồn ' + book.stockQuantity + ' cuốn) phải không?'), sources: [], action: 'confirm_toggle', book_id: bookId });
      }

      if (intent.intent === 'adjust_price' && intent.new_price) {
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0]._id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này.', sources: [] });
        const book = await Book.findById(bookId);
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'adjust_price', newPrice: intent.new_price, oldPrice: book.salePrice, bookTitle: book.title });
        return res.json({ answer: intent.message || ('Giá hiện tại của "' + book.title + '": ' + money(book.salePrice) + ' → Giá mới: ' + money(intent.new_price) + '. Xác nhận?'), sources: [], action: 'confirm_price', book_id: bookId });
      }

      if (intent.intent === 'adjust_stock' && intent.quantity) {
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0]._id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này.', sources: [] });
        const book = await Book.findById(bookId);
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'adjust_stock', quantity: intent.quantity, actionValue: intent.action || 'in', oldStock: book.stockQuantity, bookTitle: book.title });
        const verb = (intent.action === 'out') ? 'xuất' : 'nhập';
        const newStock = (intent.action === 'out') ? book.stockQuantity - intent.quantity : book.stockQuantity + intent.quantity;
        return res.json({ answer: intent.message || ('Tồn hiện tại: ' + book.stockQuantity + ' → Sau khi ' + verb + ' ' + intent.quantity + ': ' + newStock + ' cuốn. Xác nhận?'), sources: [], action: 'confirm_stock', book_id: bookId });
      }

      if (intent.intent === 'update_info' && intent.field && intent.value) {
        const bookId = intent.book_id || (dbBooks.length > 0 ? dbBooks[0]._id.toString() : null);
        if (!bookId) return res.json({ answer: 'Không tìm thấy sách này.', sources: [] });
        const book = await Book.findById(bookId);
        setBookSession(req.user.id, { step: 'awaiting_confirm', bookId: bookId, pendingAction: 'update_info', field: intent.field, value: intent.value, bookTitle: book.title });
        return res.json({ answer: intent.message || ('Cập nhật ' + intent.field + ' của "' + book.title + '" thành: ' + intent.value + '. Xác nhận?'), sources: [], action: 'confirm_update', book_id: bookId });
      }
    }

    // ── Fallback: Document RAG Search ──
    const searchResults = [];
    if (words.length >= 1) {
      const searchRegex = words.map(w => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      
      const matchedBooks = await Book.find({
        $or: [
          { title: { $in: searchRegex } },
          { author: { $in: searchRegex } }
        ]
      }).limit(3);
      matchedBooks.forEach(b => {
        searchResults.push({ entity_type: 'book', entity_id: b._id.toString(), title: b.title, snippet: b.description ? b.description.slice(0, 120) : '', rank: 0 });
      });

      const matchedDocs = await Document.find({
        $or: [
          { title: { $in: searchRegex } },
          { notes: { $in: searchRegex } },
          { extractedText: { $in: searchRegex } }
        ]
      }).limit(5);
      matchedDocs.forEach(d => {
        searchResults.push({ entity_type: 'document', entity_id: d._id.toString(), title: d.title, snippet: d.notes ? d.notes.slice(0, 120) : '', rank: 0 });
      });
    }

    const contextDocs = [];
    for (const r of searchResults.slice(0, 5)) {
      if (r.entity_type === 'document') {
        const doc = await Document.findById(r.entity_id);
        if (doc) {
          contextDocs.push({
            id: doc._id,
            title: doc.title,
            doc_type: doc.docType,
            snippet: r.snippet,
            text: (doc.extractedText || '').slice(0, 1500)
          });
        }
      } else if (r.entity_type === 'book') {
        const book = await Book.findById(r.entity_id);
        if (book) {
          contextDocs.push({
            id: book._id,
            title: book.title,
            doc_type: 'book',
            snippet: r.snippet,
            text: 'Sách: ' + book.title + (book.author ? ', tác giả: ' + book.author : '') + '. Giá bán: ' + money(book.salePrice) + '. Tồn kho: ' + book.stockQuantity + ' cuốn. ' + (book.isActive ? 'Đang bán.' : 'Đã ngưng bán.') + (book.description ? ' Mô tả: ' + book.description : '')
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
    const result = await aiService.chatWithContext(question, contextDocs, history || []);
    res.json({ answer: result.answer, sources: contextDocs.map(d => ({ document_id: d.id, title: d.title, doc_type: d.doc_type, snippet: d.snippet })) });
  } catch (e) {
    res.status(500).json({ error: 'AI chat thất bại: ' + e.message });
  }
});

app.use((err, req, res, next) => res.status(400).json({ error: err.message || 'Lỗi hệ thống' }));


// [FIX 6] Xoa don hang voi delay 5 phut + undo

const CUSTOMER_PORTAL_DEMO_PASSWORD = 'customer123';

async function ensureCustomerPortalPasswords() {
  const hash = bcrypt.hashSync(CUSTOMER_PORTAL_DEMO_PASSWORD, 10);
  const customers = await Customer.find({
    email: { $regex: /@example\.vn$/i },
    $or: [{ passwordHash: { $exists: false } }, { passwordHash: null }, { passwordHash: '' }]
  });
  for (const c of customers) {
    c.passwordHash = hash;
    if (c.isActive === undefined || c.isActive === null) c.isActive = true;
    await c.save();
  }
  if (customers.length) {
    console.log(`Đã gán mật khẩu cổng khách (${CUSTOMER_PORTAL_DEMO_PASSWORD}) cho ${customers.length} tài khoản @example.vn.`);
  }
}

async function syncBookStocksMongo() {
  try {
    const initialStocks = {
      1: 25, 2: 18, 3: 14, 4: 30, 5: 22, 6: 10, 7: 8, 8: 28, 9: 11, 10: 16,
      11: 9, 12: 20, 13: 17, 14: 24, 15: 13, 16: 26, 17: 19, 18: 12, 19: 7, 20: 5,
      21: 21, 22: 15, 23: 32, 24: 23, 25: 18, 26: 14, 27: 6, 28: 17, 29: 16, 30: 20
    };
    const books = await Book.find({});
    for (const b of books) {
      const init = initialStocks[b._id] || 0;
      const slips = await InventorySlip.find({
        status: { $ne: 'cancelled' },
        'items.bookId': b._id
      });
      let slipsSum = 0;
      slips.forEach(s => {
        s.items.forEach(item => {
          if (item.bookId === b._id) {
            slipsSum += item.quantity;
          }
        });
      });
      const orders = await Order.find({
        status: { $ne: 'cancelled' },
        'items.bookId': b._id
      });
      let salesSum = 0;
      orders.forEach(o => {
        o.items.forEach(item => {
          if (item.bookId === b._id) {
            salesSum += item.quantity;
          }
        });
      });
      const correctStock = init + slipsSum - salesSum;
      if (b.stockQuantity !== correctStock) {
        b.stockQuantity = correctStock;
        b.updatedAt = new Date();
        await b.save();
      }
    }
    console.log('MongoDB book stocks synchronized successfully.');
  } catch (err) {
    console.error('Error synchronizing MongoDB book stocks:', err.message);
  }
}

// =============================================================================
// REDIS ROUTES (NoSQL #2 — Key-Value Store)
// =============================================================================

// ── Health: Redis status ──────────────────────────────────────────────────────
app.get('/api/redis/health', auth, async (req, res) => {
  try {
    const info = await getRedisInfo();
    res.json({ ok: true, redis: info || { connected: false } });
  } catch (err) {
    res.json({ ok: false, redis: { connected: false, error: err.message } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CART ROUTES (Redis HASH + TTL 24h)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/cart/:sessionId — Lấy giỏ hàng
app.get('/api/cart/:sessionId', async (req, res) => {
  try {
    if (!isRedisActive()) return res.json({ items: [], total: 0, sessionId: req.params.sessionId, redisUnavailable: true });
    const cart = await cartService.getCart(req.params.sessionId);
    res.json(cart);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cart/:sessionId/count — Số lượng sản phẩm trong giỏ
app.get('/api/cart/:sessionId/count', async (req, res) => {
  try {
    const count = await cartService.getCartCount(req.params.sessionId);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cart/:sessionId/add — Thêm sách vào giỏ
app.post('/api/cart/:sessionId/add', async (req, res) => {
  try {
    if (!isRedisActive()) return res.status(503).json({ error: 'Redis không khả dụng' });
    const { bookId, qty = 1 } = req.body;
    if (!bookId) return res.status(400).json({ error: 'Thiếu bookId' });
    // Lấy thông tin sách từ MongoDB
    const book = await Book.findById(Number(bookId)).lean();
    if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
    if (book.stockQuantity <= 0) return res.status(400).json({ error: 'Sách đã hết hàng' });
    const cart = await cartService.addToCart(req.params.sessionId, {
      id: book._id,
      title: book.title,
      salePrice: book.salePrice,
      cover: book.coverDocumentId ? `/api/documents/${book.coverDocumentId}/download` : null,
    }, Number(qty));
    res.json({ ok: true, cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cart/:sessionId/item/:bookId — Cập nhật số lượng
app.put('/api/cart/:sessionId/item/:bookId', async (req, res) => {
  try {
    if (!isRedisActive()) return res.status(503).json({ error: 'Redis không khả dụng' });
    const { qty } = req.body;
    if (qty === undefined) return res.status(400).json({ error: 'Thiếu qty' });
    const cart = await cartService.updateCartItem(req.params.sessionId, req.params.bookId, Number(qty));
    res.json({ ok: true, cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cart/:sessionId/item/:bookId — Xóa sách khỏi giỏ
app.delete('/api/cart/:sessionId/item/:bookId', async (req, res) => {
  try {
    if (!isRedisActive()) return res.status(503).json({ error: 'Redis không khả dụng' });
    const cart = await cartService.removeFromCart(req.params.sessionId, req.params.bookId);
    res.json({ ok: true, cart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cart/:sessionId — Xóa toàn bộ giỏ hàng
app.delete('/api/cart/:sessionId', async (req, res) => {
  try {
    await cartService.clearCart(req.params.sessionId);
    res.json({ ok: true, message: 'Đã xóa giỏ hàng' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cart/:sessionId/checkout', async (req, res) => {
  try {
    if (!isRedisActive()) return res.status(503).json({ error: 'Redis không khả dụng' });
    const cart = await cartService.getCart(req.params.sessionId);
    if (!cart.items.length) return res.status(400).json({ error: 'Giỏ hàng trống' });
    const { customerName, customerEmail, paymentMethod = 'cash', notes = '' } = req.body;
    
    // Tự động nhận diện Customer ID từ Token nếu người dùng đã đăng nhập
    let customerId = null;
    let finalCustName = customerName || 'Khách lẻ';
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET);
        if (payload.id) {
          customerId = payload.id;
          const c = await Customer.findById(payload.id);
          if (c) finalCustName = c.fullName;
        }
      } catch (e) {}
    }

    // Tạo đơn hàng trong MongoDB
    const nextOrderId = await getNextId(Order);
    const orderCode = `ORD-MAU-${String(nextOrderId).padStart(3, '0')}`;
    const items = cart.items.map(i => ({
      bookId: i.bookId, bookTitle: i.title,
      quantity: i.qty, unitPrice: i.price, total: i.subtotal
    }));
    const newOrder = new Order({
      _id: nextOrderId,
      orderCode,
      customerId,
      customerName: finalCustName,
      status: 'paid',
      paymentMethod,
      subtotal: cart.total,
      discount: 0,
      tax: 0,
      total: cart.total,
      notes,
      items,
    });
    await newOrder.save();

    // Xóa giỏ hàng Redis HASH sau checkout
    await cartService.clearCart(req.params.sessionId);
    // Xóa cache doanh thu
    await cacheService.cacheInvalidate('cache:stats:*');
    await audit(null, 'create', 'order', newOrder._id, { customerId, items });
    res.json({ ok: true, orderCode: newOrder.orderCode, total: cart.total, message: 'Đặt hàng thành công!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OTP ROUTES (Redis STRING + TTL 5 phút)
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/customer/send-otp — Gửi OTP về email
app.post('/api/customer/send-otp', async (req, res) => {
  try {
    if (!isRedisActive()) return res.status(503).json({ error: 'Redis không khả dụng' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Thiếu email' });
    const result = await otpService.createOTP(email);
    if (result.alreadySent) {
      return res.status(429).json({ error: `Vui lòng chờ ${result.retryAfter}s trước khi gửi lại`, retryAfter: result.retryAfter });
    }
    res.json({ ok: true, message: `OTP đã được gửi đến ${email}`, expiresIn: result.expiresIn });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customer/verify-otp — Xác thực OTP
app.post('/api/customer/verify-otp', async (req, res) => {
  try {
    if (!isRedisActive()) return res.status(503).json({ error: 'Redis không khả dụng' });
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Thiếu email hoặc mã OTP' });
    const result = await otpService.verifyOTP(email, otp);
    if (!result.valid) return res.status(401).json({ error: result.reason });

    const cleanEmail = email.trim().toLowerCase();
    let c = await Customer.findOne({ email: new RegExp('^' + cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') });
    if (!c) {
      const nextId = await getNextId(Customer);
      const namePart = cleanEmail.split('@')[0];
      const displayName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
      c = new Customer({
        _id: nextId,
        fullName: displayName,
        email: cleanEmail,
        type: 'retail',
        isActive: true
      });
      await c.save();
    }

    const token = jwt.sign({ id: c._id, email: c.email, fullName: c.fullName, type: 'customer' }, JWT_SECRET, { expiresIn: '24h' });
    res.json({
      ok: true,
      token,
      customer: { id: c._id, email: c.email, full_name: c.fullName, phone: c.phone, type: c.type },
      message: 'Xác thực thành công'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LEADERBOARD ROUTES (Redis ZSET)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/leaderboard/books — Top sách bán chạy
app.get('/api/leaderboard/books', async (req, res) => {
  try {
    const { month, limit = 10 } = req.query;
    if (!isRedisActive()) return res.json({ leaderboard: [], redisUnavailable: true });
    const leaderboard = await cacheService.getLeaderboard(month || null, Number(limit));
    const months = await cacheService.getLeaderboardMonths();
    res.json({ leaderboard, month: month || new Date().toISOString().slice(0, 7), availableMonths: months });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leaderboard/books/:bookId/rank — Xem rank của 1 cuốn sách
app.get('/api/leaderboard/books/:bookId/rank', async (req, res) => {
  try {
    if (!isRedisActive()) return res.json({ rank: null, redisUnavailable: true });
    const { month } = req.query;
    const book = await Book.findById(Number(req.params.bookId)).select('title').lean();
    if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
    const rankInfo = await cacheService.getBookRank(book._id, book.title, month || null);
    res.json({ bookId: book._id, bookTitle: book.title, ...rankInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHE DEMO ROUTE
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/cache/hot-books — Sách hot (từ cache hoặc DB)
app.get('/api/cache/hot-books', async (req, res) => {
  const cacheKey = cacheService.cacheKey('books', 'hot');
  try {
    // Thử lấy từ cache
    const cached = await cacheService.cacheGet(cacheKey);
    if (cached) return res.json({ source: 'redis_cache', data: cached });
    // Cache miss → query MongoDB
    const books = await Book.find({ stockQuantity: { $gt: 0 } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .select('code title author salePrice stockQuantity')
      .lean();
    // Lưu vào cache
    await cacheService.cacheSet(cacheKey, books, cacheService.TTL.HOT_BOOKS);
    res.json({ source: 'mongodb', data: books });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// MONGODB FEEDBACK ROUTES (NoSQL #1 — bổ sung CRUD đầy đủ)
// GET /api/feedbacks/stats — Thống kê phân bố sentiment
app.get('/api/feedbacks/stats', auth, requirePermission('reports.view_basic'), async (req, res) => {
  try {
    const [sentimentStats, ratingStats, topBooks] = await Promise.all([
      Feedback.aggregate([
        { $group: { _id: '$sentiment', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
        { $sort: { count: -1 } },
      ]),
      Feedback.aggregate([
        { $group: { _id: '$rating', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Feedback.aggregate([
        { $group: { _id: '$bookId', bookTitle: { $first: '$bookTitle' }, count: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);
    const totalFeedbacks = await Feedback.countDocuments();
    const avgRating = await Feedback.aggregate([{ $group: { _id: null, avg: { $avg: '$rating' } } }]);
    res.json({
      total: totalFeedbacks,
      avgRating: avgRating[0]?.avg?.toFixed(2) || 0,
      sentimentDistribution: sentimentStats,
      ratingDistribution: ratingStats,
      topBooksWithFeedback: topBooks,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feedbacks/book/:bookId — Khách hàng xem feedback theo sách
app.get('/api/feedbacks/book/:bookId', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = { bookId: Number(req.params.bookId), status: 'approved' };
    const [feedbacks, total] = await Promise.all([
      Feedback.find(filter)
        .sort({ isFeatured: -1, createdAt: -1 })
        .skip(skip).limit(Number(limit))
        .select('-media')
        .lean(),
      Feedback.countDocuments(filter),
    ]);
    const avgRating = feedbacks.length ? (feedbacks.reduce((s, f) => s + f.rating, 0) / feedbacks.length).toFixed(1) : 0;
    res.json({ feedbacks, total, avgRating, page: Number(page), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// MONGODB BOOK RECOMMENDATIONS ROUTES (NoSQL MongoDB collection #2 bổ sung)
// =============================================================================

// GET /api/recommendations/:bookId — Lấy gợi ý sách liên quan
app.get('/api/recommendations/:bookId', async (req, res) => {
  try {
    const rec = await BookRecommendation.findOne({ bookId: Number(req.params.bookId) }).lean();
    if (!rec) return res.json({ bookId: Number(req.params.bookId), similarBooks: [], frequentlyBoughtTogether: [] });
    // Enrich frequentlyBoughtTogether với thông tin sách từ MongoDB
    const togetherBooks = await Book.find({ _id: { $in: rec.frequentlyBoughtTogether } })
      .select('_id title author salePrice stockQuantity')
      .lean();
    res.json({ ...rec, frequentlyBoughtTogetherDetails: togetherBooks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recommendations — Xem toàn bộ (admin)
app.get('/api/recommendations', auth, requirePermission('books.manage'), async (req, res) => {
  try {
    const recs = await BookRecommendation.find({}).lean();
    res.json({ recommendations: recs, total: recs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/recommendations — Tạo/cập nhật gợi ý sách (admin)
app.post('/api/recommendations', auth, requirePermission('books.manage'), async (req, res) => {
  try {
    const { bookId, similarBooks = [], frequentlyBoughtTogether = [] } = req.body;
    if (!bookId) return res.status(400).json({ error: 'Thiếu bookId' });
    const book = await Book.findById(Number(bookId)).select('title').lean();
    if (!book) return res.status(404).json({ error: 'Không tìm thấy sách' });
    const rec = await BookRecommendation.findOneAndUpdate(
      { bookId: Number(bookId) },
      { bookTitle: book.title, similarBooks, frequentlyBoughtTogether, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ ok: true, recommendation: rec });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/recommendations/:bookId — Xóa gợi ý (admin)
app.delete('/api/recommendations/:bookId', auth, requirePermission('books.manage'), async (req, res) => {
  try {
    await BookRecommendation.findOneAndDelete({ bookId: Number(req.params.bookId) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =============================================================================
// CART ROUTES (Redis HASH)
// =============================================================================

// GET /api/cart/:sessionId — Lấy giỏ hàng từ Redis
app.get('/api/cart/:sessionId', async (req, res) => {
  try {
    const cart = await cartService.getCart(req.params.sessionId);
    res.json(cart);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cart/:sessionId/add — Thêm sách vào giỏ Redis
app.post('/api/cart/:sessionId/add', async (req, res) => {
  try {
    const { bookId, qty = 1 } = req.body;
    if (!bookId) return res.status(400).json({ error: 'Thiếu bookId' });
    const b = await Book.findById(Number(bookId)).lean();
    if (!b) return res.status(404).json({ error: 'Không tìm thấy sách' });
    const cart = await cartService.addToCart(req.params.sessionId, {
      id: b._id,
      title: b.title,
      salePrice: b.salePrice,
      cover: b.cover_document_id || ''
    }, Number(qty) || 1);
    res.json(cart);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/cart/:sessionId/item/:bookId — Cập nhật số lượng
app.put('/api/cart/:sessionId/item/:bookId', async (req, res) => {
  try {
    const { qty } = req.body;
    if (qty === undefined) return res.status(400).json({ error: 'Thiếu qty' });
    const cart = await cartService.updateCartItem(req.params.sessionId, req.params.bookId, Number(qty));
    res.json(cart);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cart/:sessionId/item/:bookId — Xóa một sách khỏi giỏ
app.delete('/api/cart/:sessionId/item/:bookId', async (req, res) => {
  try {
    const cart = await cartService.removeFromCart(req.params.sessionId, req.params.bookId);
    res.json(cart);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cart/:sessionId — Xóa toàn bộ giỏ
app.delete('/api/cart/:sessionId', async (req, res) => {
  try {
    await cartService.clearCart(req.params.sessionId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cart/:sessionId/checkout — Đặt hàng từ Redis HASH, tạo Order MongoDB, xóa giỏ
app.post('/api/cart/:sessionId/checkout', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const cart = await cartService.getCart(sessionId);
    if (!cart.items || cart.items.length === 0) {
      return res.status(400).json({ error: 'Giỏ hàng trống' });
    }

    // Lấy customerId từ JWT nếu có
    let customerId = null;
    let custName = req.body.customerName || 'Khách lẻ';
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
        // JWT khách hàng dùng type: 'customer' hoặc type: 'otp'
        if (payload && (payload.type === 'customer' || payload.type === 'otp' || payload.role === 'customer') && payload.id) {
          const cust = await Customer.findById(payload.id).lean();
          if (cust) {
            customerId = cust._id;
            custName = cust.fullName || custName;
          }
        }
      } catch (e) { /* JWT sai thì bỏ qua */ }
    }

    // Fallback: Nếu chưa lấy được customerId từ token, tìm Customer theo email truyền lên
    const emailToSearch = (req.body.customerEmail || req.body.email || '').trim().toLowerCase();
    if (!customerId && emailToSearch) {
      const cust = await Customer.findOne({ email: new RegExp('^' + emailToSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') }).lean();
      if (cust) {
        customerId = cust._id;
        custName = cust.fullName || custName;
      }
    }

    // Kiểm tra tồn kho và tính giá
    const pricedItems = [];
    let subtotal = 0;
    for (const item of cart.items) {
      const b = await Book.findById(Number(item.bookId));
      if (!b) throw new Error(`Sách ID ${item.bookId} không tồn tại`);
      if (b.stockQuantity < item.qty) throw new Error(`Không đủ tồn kho: ${b.title} (còn ${b.stockQuantity})`);
      const itemTotal = b.salePrice * item.qty;
      subtotal += itemTotal;
      pricedItems.push({
        bookId: b._id,
        bookCode: b.code,
        bookTitle: b.title,
        quantity: item.qty,
        unitPrice: b.salePrice,
        total: itemTotal
      });
    }

    const nextOrderId = await getNextId(Order);
    const orderCode = `ORD-WEB-${String(nextOrderId).padStart(3, '0')}`;
    const noteStr = (req.body.notes || req.body.orderNotes || '').trim() || 'Đặt qua website';

    const orderObj = new Order({
      _id: nextOrderId,
      orderCode,
      customerId: customerId || null,
      customerName: custName,
      status: 'paid',
      paymentMethod: 'online',
      subtotal,
      discount: 0,
      tax: 0,
      total: subtotal,
      notes: noteStr,
      channel: 'web',
      createdBy: customerId || null,
      items: pricedItems
    });
    await orderObj.save();

    // Cập nhật Leaderboard Redis ngay khi đặt hàng (theo spec 6.2)
    if (isRedisActive() && pricedItems.length) {
      const month = new Date().toISOString().slice(0, 7);
      await cacheService.incrementLeaderboard(
        pricedItems.map(i => ({ bookId: i.bookId, bookTitle: i.bookTitle, quantity: i.quantity })),
        month
      );
    }

    // Xóa giỏ hàng Redis HASH sau khi đặt hàng thành công
    await cartService.clearCart(sessionId);

    res.status(201).json({
      ok: true,
      orderCode,
      total: subtotal,
      itemCount: pricedItems.length
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// =============================================================================
// SERVER STARTUP
// =============================================================================
app.listen(PORT, async () => {
  console.log(`Bookstore MongoDB MVP running: http://localhost:${PORT}`);
  // Kết nối Redis (không bắt buộc — ứng dụng vẫn chạy nếu Redis không có)
  await connectRedis();
  try {
    try { await backfillTodayLogMongo(); } catch (e) {}
    try { await ensureCustomerPortalPasswords(); } catch (e) { console.error('ensureCustomerPortalPasswords:', e.message); }
    try { await Book.collection.dropIndexes(); } catch (e) {}
    try { await Document.collection.dropIndexes(); } catch (e) {}

    await Promise.all([
      Book.ensureIndexes(),
      Document.ensureIndexes()
    ]);
    console.log('MongoDB text indexes synchronized successfully.');
    try { await syncBookStocksMongo(); } catch (e) { console.error('syncBookStocksMongo error:', e.message); }
  } catch (err) {
    console.error('Error synchronizing MongoDB indexes:', err);
  }
});






