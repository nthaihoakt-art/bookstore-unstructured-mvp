const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const betterSqlite3Path = 'c:/Users/Admin/.openclaw/workspace/1/bookstore-unstructured-mvp/node_modules/better-sqlite3';
const Database = require(betterSqlite3Path);

const dbPath = 'c:/Users/Admin/.openclaw/workspace/1/bookstore-unstructured-mvp/bookstore.db';
const uploadsDir = 'c:/Users/Admin/.openclaw/workspace/1/bookstore-unstructured-mvp/uploads';
const artifactDir = 'C:/Users/Admin/.gemini/antigravity/brain/17275c79-37b3-4279-86c6-ba86a0867216';

const db = new Database(dbPath);

const covers = [
  {
    code: 'BOOK-001',
    title: 'Ảnh bìa Mắt Biếc',
    filePattern: /^mat_biec_cover_.*\.png$/,
    originalName: 'mat_biec_cover.png'
  },
  {
    code: 'BOOK-002',
    title: 'Ảnh bìa Cho tôi xin một vé đi tuổi thơ',
    filePattern: /^tuoi_tho_cover_.*\.png$/,
    originalName: 'tuoi_tho_cover.png'
  },
  {
    code: 'BOOK-003',
    title: 'Ảnh bìa Tôi thấy hoa vàng trên cỏ xanh',
    filePattern: /^hoa_vang_cover_.*\.png$/,
    originalName: 'hoa_vang_cover.png'
  },
  {
    code: 'BOOK-005',
    title: 'Ảnh bìa Nhà Giả Kim',
    filePattern: /^gia_kim_cover_.*\.png$/,
    originalName: 'gia_kim_cover.png'
  }
];

// Find the file in the artifact directory
function findFile(pattern) {
  const files = fs.readdirSync(artifactDir);
  const match = files.find(f => pattern.test(f));
  return match ? path.join(artifactDir, match) : null;
}

try {
  covers.forEach(c => {
    const book = db.prepare('SELECT id, title FROM books WHERE code = ?').get(c.code);
    if (!book) {
      console.log(`Book not found for code: ${c.code}`);
      return;
    }
    
    const srcPath = findFile(c.filePattern);
    if (!srcPath) {
      console.log(`Source image not found for pattern: ${c.filePattern}`);
      return;
    }
    
    const ext = path.extname(srcPath);
    const storedName = `seed-cover-${c.code.toLowerCase()}${ext}`;
    const destPath = path.join(uploadsDir, storedName);
    
    // Copy the file
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${srcPath} to ${destPath}`);
    
    // Calculate checksum
    const fileBytes = fs.readFileSync(destPath);
    const checksum = crypto.createHash('sha256').update(fileBytes).digest('hex');
    const size = fileBytes.length;
    
    // Check if document already exists
    let doc = db.prepare('SELECT id FROM documents WHERE checksum = ?').get(checksum);
    let docId;
    if (doc) {
      docId = doc.id;
      console.log(`Document already exists with ID: ${docId}`);
    } else {
      // Insert document
      const res = db.prepare(`
        INSERT INTO documents (
          original_name, stored_name, mime_type, size, checksum, doc_type,
          entity_type, entity_id, title, notes, tags, is_important,
          ocr_status, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        c.originalName,
        storedName,
        'image/png',
        size,
        checksum,
        'cover',
        'book',
        book.id,
        c.title,
        `Ảnh bìa của cuốn sách ${book.title}`,
        JSON.stringify(['bìa sách', 'mẫu']),
        0,
        'not_required',
        1 // Admin user ID
      );
      docId = res.lastInsertRowid;
      console.log(`Inserted document ID: ${docId} for book: ${book.title}`);
      
      // Insert document metadata
      db.prepare(`
        INSERT OR IGNORE INTO document_metadata (document_id, meta_key, meta_value)
        VALUES (?, ?, ?)
      `).run(docId, 'source', 'seed_cover');
    }
    
    // Update book's cover_document_id
    db.prepare('UPDATE books SET cover_document_id = ? WHERE id = ?').run(docId, book.id);
    console.log(`Updated book ${book.title} with cover_document_id = ${docId}`);
  });
  console.log('Seeding covers completed successfully.');
} catch (e) {
  console.error('Error seeding covers:', e);
}
db.close();
