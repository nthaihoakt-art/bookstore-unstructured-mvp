const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, rebuildBookIndex, rebuildDocumentIndex, setDocumentMetadata } = require('../src/db');

const uploadsDir = path.join(__dirname, '..', 'uploads');

const covers = [
  {
    code: 'BOOK-001',
    storedName: 'seed-cover-book-001.png',
    originalName: 'mat_biec_cover.png',
    title: 'Ảnh bìa Mắt Biếc'
  },
  {
    code: 'BOOK-002',
    storedName: 'seed-cover-book-002.png',
    originalName: 'tuoi_tho_cover.png',
    title: 'Ảnh bìa Cho tôi xin một vé đi tuổi thơ'
  },
  {
    code: 'BOOK-003',
    storedName: 'seed-cover-book-003.png',
    originalName: 'hoa_vang_cover.png',
    title: 'Ảnh bìa Tôi thấy hoa vàng trên cỏ xanh'
  },
  {
    code: 'BOOK-004',
    storedName: 'seed-cover-book-004.png',
    originalName: 'dac_nhan_tam_cover.png',
    title: 'Ảnh bìa Đắc Nhân Tâm'
  },
  {
    code: 'BOOK-005',
    storedName: 'seed-cover-book-005.png',
    originalName: 'gia_kim_cover.png',
    title: 'Ảnh bìa Nhà Giả Kim'
  },
  {
    code: 'BOOK-006',
    storedName: 'seed-cover-book-006.png',
    originalName: 'rung_na_uy_cover.png',
    title: 'Ảnh bìa Rừng Na Uy'
  }
];

try {
  // Find admin user ID
  const adminUser = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@bookstore.local');
  const adminId = adminUser ? adminUser.id : 1;

  covers.forEach(c => {
    const book = db.prepare('SELECT id, title FROM books WHERE code = ?').get(c.code);
    if (!book) {
      console.log(`Không tìm thấy sách có mã: ${c.code}`);
      return;
    }

    const filePath = path.join(uploadsDir, c.storedName);
    if (!fs.existsSync(filePath)) {
      console.log(`Không tìm thấy file ảnh bìa vật lý tại: ${filePath}`);
      return;
    }

    // Calculate checksum & size
    const fileBytes = fs.readFileSync(filePath);
    const checksum = crypto.createHash('sha256').update(fileBytes).digest('hex');
    const size = fileBytes.length;

    // Check if document already exists
    let doc = db.prepare('SELECT id FROM documents WHERE checksum = ?').get(checksum);
    let docId;

    if (doc) {
      docId = doc.id;
      console.log(`Tài liệu ảnh bìa đã tồn tại trong DB với ID: ${docId}`);
    } else {
      // Insert new document into database
      const res = db.prepare(`
        INSERT INTO documents (
          original_name, stored_name, mime_type, size, checksum, doc_type,
          entity_type, entity_id, title, notes, tags, is_important,
          ocr_status, uploaded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        c.originalName,
        c.storedName,
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
        adminId
      );
      docId = res.lastInsertRowid;
      console.log(`Đã lưu tài liệu ảnh bìa mới ID: ${docId} cho sách: ${book.title}`);

      // Insert metadata
      setDocumentMetadata(docId, {
        source: 'seed_cover',
        businessPurpose: 'Ảnh bìa phục vụ hiển thị chi tiết sách'
      });
      rebuildDocumentIndex(docId);
    }

    // Link the book to the cover image
    db.prepare('UPDATE books SET cover_document_id = ? WHERE id = ?').run(docId, book.id);
    rebuildBookIndex(book.id);
    console.log(`Liên kết thành công sách "${book.title}" với ảnh bìa ID: ${docId}`);
  });

  console.log('Hoàn thành liên kết ảnh bìa thành công!');
} catch (e) {
  console.error('Lỗi khi chạy liên kết ảnh bìa:', e);
}
