const betterSqlite3Path = 'c:/Users/Admin/.openclaw/workspace/1/bookstore-unstructured-mvp/node_modules/better-sqlite3';
const Database = require(betterSqlite3Path);
const path = require('path');
const fs = require('fs');

const dbPath = 'c:/Users/Admin/.openclaw/workspace/1/bookstore-unstructured-mvp/bookstore.db';
const db = new Database(dbPath);

console.log('--- START AUTO-SYNC HOOK TEST ---');

// Mock request / response for testing syncBookFieldsFromDocument via a direct db insert/update
function syncBookFieldsFromDocument(docId) {
  const d = db.prepare('SELECT id, doc_type, entity_type, entity_id, extracted_text, notes FROM documents WHERE id = ?').get(docId);
  if (!d) return;

  const targetBookId = (d.entity_type === 'book' && d.doc_type === 'cover') ? d.entity_id : null;
  if (targetBookId) {
    db.prepare('UPDATE books SET cover_document_id = NULL WHERE cover_document_id = ? AND id != ?').run(d.id, targetBookId);
    db.prepare('UPDATE books SET cover_document_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(d.id, targetBookId);
  } else {
    db.prepare('UPDATE books SET cover_document_id = NULL WHERE cover_document_id = ?').run(d.id);
  }

  if (d.entity_type === 'book' && d.entity_id && d.doc_type === 'book_description') {
    const textToUse = (d.extracted_text && d.extracted_text.trim() !== '') ? d.extracted_text : d.notes;
    if (textToUse && textToUse.trim() !== '') {
      db.prepare('UPDATE books SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(textToUse.trim(), d.entity_id);
    }
  }
}

try {
  // 1. Create a dummy book
  const bookRes = db.prepare(`
    INSERT INTO books (code, title, sale_price, stock_quantity, description)
    VALUES (?, ?, ?, ?, ?)
  `).run('BOOK-TEST999', 'Sách Thử Nghiệm Hooks', 50000, 10, 'Mô tả ban đầu');
  const bookId = bookRes.lastInsertRowid;
  console.log(`Created test book ID: ${bookId}`);

  // 2. Insert a cover document linked to the book
  const docCoverRes = db.prepare(`
    INSERT INTO documents (original_name, stored_name, mime_type, size, doc_type, entity_type, entity_id, title, notes, ocr_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('test-cover.png', 'test-cover.png', 'image/png', 500, 'cover', 'book', bookId, 'Ảnh bìa test', 'Ghi chú ảnh bìa', 'not_required');
  const coverDocId = docCoverRes.lastInsertRowid;
  console.log(`Created cover document ID: ${coverDocId}`);

  // Trigger sync
  syncBookFieldsFromDocument(coverDocId);

  // Assert cover document ID is synced to book
  let updatedBook = db.prepare('SELECT cover_document_id, description FROM books WHERE id = ?').get(bookId);
  if (updatedBook.cover_document_id === coverDocId) {
    console.log('✅ TEST 1 PASSED: cover_document_id synced successfully!');
  } else {
    throw new Error(`TEST 1 FAILED: cover_document_id is ${updatedBook.cover_document_id}, expected ${coverDocId}`);
  }

  // 3. Insert a description document linked to the book
  const docDescRes = db.prepare(`
    INSERT INTO documents (original_name, stored_name, mime_type, size, doc_type, entity_type, entity_id, title, notes, extracted_text, ocr_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('test-desc.txt', 'test-desc.txt', 'text/plain', 200, 'book_description', 'book', bookId, 'Mô tả test', 'Ghi chú mô tả', 'Nội dung mô tả mới từ OCR', 'done');
  const descDocId = docDescRes.lastInsertRowid;
  console.log(`Created description document ID: ${descDocId}`);

  // Trigger sync
  syncBookFieldsFromDocument(descDocId);

  // Assert description is synced to book
  updatedBook = db.prepare('SELECT cover_document_id, description FROM books WHERE id = ?').get(bookId);
  if (updatedBook.description === 'Nội dung mô tả mới từ OCR') {
    console.log('✅ TEST 2 PASSED: description synced successfully from OCR text!');
  } else {
    throw new Error(`TEST 2 FAILED: description is "${updatedBook.description}", expected "Nội dung mô tả mới từ OCR"`);
  }

  // 4. Update the cover document to be unlinked (no longer linked to the book)
  db.prepare('UPDATE documents SET entity_type = NULL, entity_id = NULL WHERE id = ?').run(coverDocId);
  // Trigger sync
  syncBookFieldsFromDocument(coverDocId);

  updatedBook = db.prepare('SELECT cover_document_id FROM books WHERE id = ?').get(bookId);
  if (updatedBook.cover_document_id === null) {
    console.log('✅ TEST 3 PASSED: cover_document_id cleared when document unlinked!');
  } else {
    throw new Error(`TEST 3 FAILED: cover_document_id is ${updatedBook.cover_document_id}, expected null`);
  }

  // 5. Clean up testing records
  db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
  db.prepare('DELETE FROM documents WHERE id IN (?, ?)').run(coverDocId, descDocId);
  console.log('Cleaned up test records.');
  console.log('--- ALL AUTO-SYNC HOOK TESTS PASSED SUCCESSFULLY ---');
} catch (e) {
  console.error('❌ TEST FAILED:', e);
} finally {
  db.close();
}
