require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // Ignore error if DNS override fails
}
const Database = require('better-sqlite3');

// Config connection strings
const SQLITE_PATH = path.join(__dirname, '..', 'bookstore.db');
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://nnp1426_db_user:SjipRoD5Q4CDpEiU@cluster0.1ovaxuk.mongodb.net/bookstore_migrated?appName=Cluster0';

// Dynamic import mongoose to prevent crash if not installed yet
let mongoose;
try {
  mongoose = require('mongoose');
} catch (err) {
  console.error('LỖI: Chưa cài đặt thư viện mongoose. Vui lòng chạy lệnh: npm install mongoose');
  process.exit(1);
}

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
  tags: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Book = mongoose.model('Book', bookSchema);

const customerSchema = new mongoose.Schema({
  _id: Number,
  fullName: { type: String, required: true },
  phone: String,
  email: String,
  type: { type: String, default: 'retail' },
  notes: String,
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
  tags: [String],
  isImportant: { type: Boolean, default: false },
  extractedText: String,
  ocrStatus: { type: String, default: 'not_required' },
  processingError: String,
  uploadedBy: Number,
  metadata: mongoose.Schema.Types.Map,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Document = mongoose.model('Document', documentSchema);

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
const Feedback = mongoose.model('Feedback', feedbackSchema);

const auditLogSchema = new mongoose.Schema({
  _id: Number,
  userId: Number,
  action: { type: String, required: true },
  entityType: String,
  entityId: Number,
  details: String,
  createdAt: { type: Date, default: Date.now }
});
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

// -------------------------------------------------------------
// MIGRATION SCRIPT
// -------------------------------------------------------------
async function migrate() {
  console.log(`Bắt đầu kết nối SQLite tại: ${SQLITE_PATH}`);
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error('LỖI: Không tìm thấy file bookstore.db của SQLite!');
    process.exit(1);
  }
  const sqliteDb = new Database(SQLITE_PATH);

  console.log(`Đang kết nối MongoDB tại: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);
  console.log('Đã kết nối MongoDB thành công! Đang xóa database migrated cũ để ghi đè sạch...');
  await mongoose.connection.db.dropDatabase();
  console.log('Database MongoDB trống. Bắt đầu ánh xạ dữ liệu...');

  // Mappings to track old SQLite IDs -> new MongoDB ObjectIds
  const maps = {
    roles: {},      // sqlite_role_id -> role_name
    users: {},      // sqlite_user_id -> new MongoDB User _id
    books: {},      // sqlite_book_id -> new MongoDB Book _id
    customers: {},  // sqlite_customer_id -> new MongoDB Customer _id
    suppliers: {},  // sqlite_supplier_id -> new MongoDB Supplier _id
    orders: {},     // sqlite_order_id -> new MongoDB Order _id
    documents: {},  // sqlite_doc_id -> new MongoDB Document _id
    slips: {}       // sqlite_slip_id -> new MongoDB Slip _id
  };

  // 1. MIGRATE ROLES & PERMISSIONS
  console.log('\n[1/10] Chuyển đổi Roles & Permissions...');
  const sqliteRoles = sqliteDb.prepare('SELECT * FROM roles').all();
  for (const r of sqliteRoles) {
    const perms = sqliteDb.prepare(`
      SELECT p.code FROM permissions p 
      JOIN role_permissions rp ON rp.permission_id = p.id 
      WHERE rp.role_id = ?
    `).all(r.id).map(p => p.code);

    const doc = new Role({
      _id: r.id,
      name: r.name,
      description: r.description,
      permissions: perms
    });
    await doc.save();
    maps.roles[r.id] = r.name;
  }
  console.log(`  -> Đã di chuyển ${sqliteRoles.length} vai trò.`);

  // 2. MIGRATE USERS
  console.log('\n[2/10] Chuyển đổi Users...');
  const sqliteUsers = sqliteDb.prepare('SELECT * FROM users').all();
  for (const u of sqliteUsers) {
    const doc = new User({
      _id: u.id,
      fullName: u.full_name,
      email: u.email,
      passwordHash: u.password_hash,
      role: maps.roles[u.role_id] || 'sales',
      isActive: u.is_active === 1,
      createdAt: new Date(u.created_at)
    });
    await doc.save();
    maps.users[u.id] = doc._id;
  }
  console.log(`  -> Đã di chuyển ${sqliteUsers.length} nhân viên.`);

  // 3. MIGRATE SUPPLIERS
  console.log('\n[3/10] Chuyển đổi Suppliers...');
  const sqliteSuppliers = sqliteDb.prepare('SELECT * FROM suppliers').all();
  for (const s of sqliteSuppliers) {
    const doc = new Supplier({
      _id: s.id,
      name: s.name,
      contactName: s.contact_name,
      phone: s.phone,
      email: s.email,
      address: s.address,
      notes: s.notes,
      rating: s.rating,
      createdAt: new Date(s.created_at)
    });
    await doc.save();
    maps.suppliers[s.id] = doc._id;
  }
  console.log(`  -> Đã di chuyển ${sqliteSuppliers.length} nhà cung cấp.`);

  // 4. MIGRATE CUSTOMERS
  console.log('\n[4/10] Chuyển đổi Customers...');
  const sqliteCustomers = sqliteDb.prepare('SELECT * FROM customers').all();
  for (const c of sqliteCustomers) {
    const doc = new Customer({
      _id: c.id,
      fullName: c.full_name,
      phone: c.phone,
      email: c.email,
      type: c.type,
      notes: c.notes,
      createdBy: maps.users[c.created_by] || null,
      createdAt: new Date(c.created_at)
    });
    await doc.save();
    maps.customers[c.id] = doc._id;
  }
  console.log(`  -> Đã di chuyển ${sqliteCustomers.length} khách hàng.`);

  // 5. MIGRATE BOOKS (embedding author/category/publisher names)
  console.log('\n[5/10] Chuyển đổi Books...');
  const sqliteBooks = sqliteDb.prepare(`
    SELECT b.*, a.name author, c.name category, p.name publisher 
    FROM books b
    LEFT JOIN authors a ON a.id = b.author_id
    LEFT JOIN categories c ON c.id = b.category_id
    LEFT JOIN publishers p ON p.id = b.publisher_id
  `).all();
  for (const b of sqliteBooks) {
    let tags = [];
    try {
      tags = JSON.parse(b.tags || '[]');
    } catch(e) {}

    const doc = new Book({
      _id: b.id,
      code: b.code,
      title: b.title,
      author: b.author || null,
      category: b.category || null,
      publisher: b.publisher || null,
      isbn: b.isbn,
      publishedYear: b.published_year,
      pages: b.pages,
      language: b.language,
      importPrice: b.import_price,
      salePrice: b.sale_price,
      stockQuantity: b.stock_quantity,
      isActive: b.is_active === 1,
      description: b.description,
      excerpt: b.excerpt,
      tags: tags,
      createdAt: new Date(b.created_at),
      updatedAt: new Date(b.updated_at)
    });
    await doc.save();
    maps.books[b.id] = doc._id;
  }
  console.log(`  -> Đã di chuyển ${sqliteBooks.length} cuốn sách.`);

  // 6. MIGRATE ORDERS (embedding items list)
  console.log('\n[6/10] Chuyển đổi Orders & Order Items...');
  const sqliteOrders = sqliteDb.prepare('SELECT * FROM orders').all();
  for (const o of sqliteOrders) {
    const sqliteItems = sqliteDb.prepare(`
      SELECT oi.*, b.title, b.code 
      FROM order_items oi
      JOIN books b ON b.id = oi.book_id
      WHERE oi.order_id = ?
    `).all(o.id);

    const docItems = sqliteItems.map(i => ({
      bookId: maps.books[i.book_id],
      bookCode: i.code,
      bookTitle: i.title,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      total: i.total
    }));

    const customer = o.customer_id ? sqliteDb.prepare('SELECT full_name FROM customers WHERE id=?').get(o.customer_id) : null;

    const doc = new Order({
      _id: o.id,
      orderCode: o.order_code,
      customerId: maps.customers[o.customer_id] || null,
      customerName: customer ? customer.full_name : 'Khách lẻ',
      status: o.status,
      paymentMethod: o.payment_method,
      subtotal: o.subtotal,
      discount: o.discount,
      tax: o.tax,
      total: o.total,
      notes: o.notes,
      createdBy: maps.users[o.created_by] || null,
      items: docItems,
      createdAt: new Date(o.created_at)
    });
    await doc.save();
    maps.orders[o.id] = doc._id;
  }
  console.log(`  -> Đã di chuyển ${sqliteOrders.length} hóa đơn bán hàng.`);

  // 7. MIGRATE INVENTORY SLIPS
  console.log('\n[7/10] Chuyển đổi Inventory Slips...');
  const sqliteSlips = sqliteDb.prepare('SELECT * FROM inventory_slips').all();
  for (const sl of sqliteSlips) {
    const sqliteTransactions = sqliteDb.prepare(`
      SELECT it.*, b.title, b.code 
      FROM inventory_transactions it
      JOIN books b ON b.id = it.book_id
      WHERE it.slip_id = ?
    `).all(sl.id);

    const docItems = sqliteTransactions.map(t => ({
      bookId: maps.books[t.book_id],
      bookCode: t.code,
      bookTitle: t.title,
      quantity: t.quantity,
      unitCost: t.unit_cost,
      note: t.note
    }));

    const doc = new InventorySlip({
      _id: sl.id,
      slipCode: sl.slip_code,
      type: sl.type,
      supplierId: maps.suppliers[sl.supplier_id] || null,
      note: sl.note,
      status: sl.status,
      createdBy: maps.users[sl.created_by] || null,
      cancelledAt: sl.cancelled_at ? new Date(sl.cancelled_at) : null,
      cancelledBy: maps.users[sl.cancelled_by] || null,
      items: docItems,
      createdAt: new Date(sl.created_at)
    });
    await doc.save();
    maps.slips[sl.id] = doc._id;
  }
  console.log(`  -> Đã di chuyển ${sqliteSlips.length} phiếu kho.`);

  // 8. MIGRATE DOCUMENTS (resolving Polymorphic Relations & metadata)
  console.log('\n[8/10] Chuyển đổi Documents & Metadata...');
  const sqliteDocs = sqliteDb.prepare('SELECT * FROM documents').all();
  for (const d of sqliteDocs) {
    // Resolve polymorphic entityId in MongoDB
    let mongoEntityId = null;
    if (d.entity_type === 'book' && d.entity_id) mongoEntityId = maps.books[d.entity_id];
    else if (d.entity_type === 'supplier' && d.entity_id) mongoEntityId = maps.suppliers[d.entity_id];
    else if (d.entity_type === 'order' && d.entity_id) mongoEntityId = maps.orders[d.entity_id];
    else if (d.entity_type === 'customer' && d.entity_id) mongoEntityId = maps.customers[d.entity_id];
    else if (d.entity_type === 'inventory_slip' && d.entity_id) mongoEntityId = maps.slips[d.entity_id];

    // Read extra metadata keys from SQL
    const extraMeta = {};
    const metadataRows = sqliteDb.prepare('SELECT meta_key, meta_value FROM document_metadata WHERE document_id=?').all(d.id);
    metadataRows.forEach(row => {
      extraMeta[row.meta_key] = row.meta_value;
    });

    let tags = [];
    try {
      tags = JSON.parse(d.tags || '[]');
    } catch(e) {}

    const doc = new Document({
      _id: d.id,
      originalName: d.original_name,
      storedName: d.stored_name,
      mimeType: d.mime_type,
      size: d.size,
      checksum: d.checksum,
      docType: d.doc_type,
      entityType: d.entity_type,
      entityId: mongoEntityId,
      title: d.title,
      notes: d.notes,
      tags: tags,
      isImportant: d.is_important === 1,
      extractedText: d.extracted_text,
      ocrStatus: d.ocr_status,
      processingError: d.processing_error,
      uploadedBy: maps.users[d.uploaded_by] || null,
      metadata: extraMeta,
      createdAt: new Date(d.created_at),
      updatedAt: new Date(d.updated_at)
    });
    await doc.save();
    maps.documents[d.id] = doc._id;
  }
  console.log(`  -> Đã di chuyển ${sqliteDocs.length} tệp tài liệu phi cấu trúc.`);

  // 9. UPDATE COVER LINKS IN BOOKS (Cross-referencing Documents back to Books)
  console.log('\n[9/10] Đồng bộ khóa liên kết Ảnh bìa của Sách...');
  const booksWithCovers = sqliteDb.prepare('SELECT id, cover_document_id FROM books WHERE cover_document_id IS NOT NULL').all();
  let coverSyncCount = 0;
  for (const b of booksWithCovers) {
    const mongoBookId = maps.books[b.id];
    const mongoDocId = maps.documents[b.cover_document_id];
    if (mongoBookId && mongoDocId) {
      await Book.findByIdAndUpdate(mongoBookId, { coverDocumentId: mongoDocId });
      coverSyncCount++;
    }
  }
  console.log(`  -> Đã liên kết thành công ${coverSyncCount} ảnh bìa.`);

  // 10. MIGRATE REVIEWS & AUDIT LOGS
  console.log('\n[10/10] Chuyển đổi Reviews/Feedback → Feedback & Audit Logs...');
  const feedbackTableExists = sqliteDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback'").get();
  const feedbackCount = feedbackTableExists ? sqliteDb.prepare('SELECT COUNT(*) c FROM feedback').get().c : 0;
  
  if (feedbackCount > 0) {
    const sqliteFeedbacks = sqliteDb.prepare('SELECT * FROM feedback').all();
    for (const f of sqliteFeedbacks) {
      let tags = [];
      try { tags = JSON.parse(f.tags || '[]'); } catch (e) {}
      
      const images = sqliteDb.prepare('SELECT * FROM feedback_images WHERE feedback_id = ?').all(f.id);
      const mediaList = [];
      for (const img of images) {
        try {
          if (fs.existsSync(img.file_path)) {
            const fileData = fs.readFileSync(img.file_path);
            const ext = path.extname(img.file_name).toLowerCase();
            const fileType = ext === '.png' ? 'image/png' : 'image/jpeg';
            mediaList.push({
              fileName: img.file_name,
              fileType: fileType,
              fileSizeKB: img.file_size_kb || Math.round(fileData.length / 1024),
              fileData: fileData
            });
          }
        } catch (err) {
          console.warn(`Không thể đọc ảnh feedback: ${img.file_path}`, err.message);
        }
      }
      
      const doc = new Feedback({
        _id: f.id,
        bookId: maps.books[f.book_id] || null,
        customerId: maps.customers[f.customer_id] || null,
        customerName: f.customer_name,
        email: f.email || '',
        rating: f.rating,
        comment: f.comment,
        tags: tags,
        media: mediaList,
        sentiment: f.sentiment || 'neutral',
        score: f.score || 0.5,
        isFeatured: f.is_featured === 1,
        status: f.status || 'new',
        createdAt: new Date(f.created_at)
      });
      await doc.save();
    }
    console.log(`  -> Đã di chuyển ${sqliteFeedbacks.length} phản hồi từ bảng feedback.`);
  } else {
    const sqliteReviews = sqliteDb.prepare('SELECT * FROM reviews').all();
    for (const r of sqliteReviews) {
      const rating = r.rating || 3;
      const isFeatured = rating >= 4;
      const sentiment = rating >= 4 ? 'positive' : (rating <= 2 ? 'negative' : 'neutral');
      const customer = sqliteDb.prepare('SELECT full_name, email FROM customers WHERE id = ?').get(r.customer_id);
      const doc = new Feedback({
        _id: r.id,
        bookId: maps.books[r.book_id] || null,
        customerId: maps.customers[r.customer_id] || null,
        customerName: customer ? customer.full_name : 'Khách hàng',
        email: customer ? customer.email : '',
        rating,
        comment: r.content || '',
        tags: [],
        media: [],
        sentiment,
        score: rating / 5,
        isFeatured,
        status: 'reviewed',
        createdAt: new Date(r.created_at)
      });
      await doc.save();
    }
    console.log(`  -> Đã di chuyển ${sqliteReviews.length} đánh giá (Feedback) từ bảng reviews.`);
  }

  const sqliteLogs = sqliteDb.prepare('SELECT * FROM audit_logs').all();
  for (const l of sqliteLogs) {
    let mongoLogEntityId = null;
    if (l.entity_type === 'book' && l.entity_id) mongoLogEntityId = maps.books[l.entity_id];
    else if (l.entity_type === 'document' && l.entity_id) mongoLogEntityId = maps.documents[l.entity_id];
    else if (l.entity_type === 'order' && l.entity_id) mongoLogEntityId = maps.orders[l.entity_id];
    else if (l.entity_type === 'customer' && l.entity_id) mongoLogEntityId = maps.customers[l.entity_id];

    const doc = new AuditLog({
      _id: l.id,
      userId: maps.users[l.user_id] || null,
      action: l.action,
      entityType: l.entity_type,
      entityId: mongoLogEntityId,
      details: l.details,
      createdAt: new Date(l.created_at)
    });
    await doc.save();
  }
  console.log(`  -> Đã di chuyển ${sqliteLogs.length} nhật ký hệ thống.`);

  // Đồng bộ indexes (bao gồm cả TTL)
  await Promise.all([
    mongoose.model('Book').syncIndexes(),
    mongoose.model('Document').syncIndexes(),
    mongoose.model('AuditLog').syncIndexes(),
    Feedback.syncIndexes()
  ]);
  console.log('  -> Đã đồng bộ indexes (TTL cleanup: 90d audit, 365d report, 730d feedback).');

  console.log('\n======================================================');
  console.log('MIGRATION HOÀN TẤT THÀNH CÔNG! 🎉🎉');
  console.log(`Database SQLite gốc của bạn (${SQLITE_PATH}) KHÔNG HỀ BỊ THAY ĐỔI.`);
  console.log(`Dữ liệu đã được nạp sạch sẽ lên MongoDB: ${MONGO_URI}`);
  console.log('Bạn có thể kết nối với CSDL mới để đối chiếu cấu trúc.');
  console.log('======================================================');
}

migrate()
  .then(() => {
    mongoose.connection.close();
    process.exit(0);
  })
  .catch(err => {
    console.error('\nLỖI khi chạy migration:', err);
    try { mongoose.connection.close(); } catch(e) {}
    process.exit(1);
  });
