const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'report-docx-temp');
const outFile = path.join(root, 'Bao_cao_do_an_quan_tri_du_lieu_phi_cau_truc_Bookstore.docx');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, '_rels'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'word', '_rels'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'docProps'), { recursive: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sections = [
  ['BÁO CÁO ĐỒ ÁN', 'Hệ thống quản lý nhà sách và quản trị dữ liệu phi cấu trúc Bookstore'],
  ['Thông tin chung', [
    'Tên đồ án: Xây dựng hệ thống quản lý nhà sách tích hợp quản trị dữ liệu phi cấu trúc.',
    'Bối cảnh: Nhà sách không chỉ quản lý dữ liệu có cấu trúc như sách, đơn hàng, khách hàng, tồn kho mà còn phát sinh nhiều tài liệu phi cấu trúc như hóa đơn nhập hàng, hợp đồng nhà cung cấp, ảnh bìa sách, ghi chú kiểm kê, phản hồi khách hàng và mô tả sản phẩm.',
    'Mục tiêu: Xây dựng MVP có khả năng lưu trữ, trích xuất, lập chỉ mục, tìm kiếm, phân quyền và kiểm soát truy cập đối với cả dữ liệu có cấu trúc và phi cấu trúc.'
  ]],
  ['1. Lý do chọn đề tài', [
    'Trong hoạt động nhà sách, dữ liệu phi cấu trúc xuất hiện ở nhiều dạng: file PDF hóa đơn, DOCX hợp đồng, ảnh scan/ảnh bìa, file TXT ghi chú, phản hồi khách hàng và tài liệu nghiệp vụ nội bộ.',
    'Nếu chỉ lưu file trong thư mục, người dùng khó tìm lại nội dung, khó kiểm soát quyền truy cập, khó biết ai tải lên hoặc chỉnh sửa, và không khai thác được thông tin trong tài liệu.',
    'Đồ án tập trung giải quyết bài toán quản trị dữ liệu phi cấu trúc bằng cách biến tài liệu rời rạc thành tài nguyên có metadata, nội dung trích xuất, chỉ mục tìm kiếm và RBAC.'
  ]],
  ['2. Phạm vi và chức năng chính', [
    'Quản lý dữ liệu có cấu trúc: sách, khách hàng, đơn hàng, nhà cung cấp, phiếu nhập/xuất/điều chỉnh kho, người dùng, vai trò, quyền và nhật ký hoạt động.',
    'Quản lý dữ liệu phi cấu trúc: upload tài liệu, kiểm tra loại file, lưu metadata, tính checksum, trích xuất nội dung, OCR ảnh, xem preview/download qua API có xác thực, tìm kiếm toàn văn.',
    'Bảo mật và quản trị: đăng nhập JWT, phân quyền theo permission, giao diện theo vai trò, route guard frontend, enforcement backend, ownership scope cho tài liệu/khách hàng/đơn hàng.',
    'Dữ liệu demo: seeded database SQLite với dữ liệu giả của nhà sách Việt Nam và thư mục uploads chứa tài liệu mẫu.'
  ]],
  ['3. Kiến trúc hệ thống', [
    'Backend: Node.js/Express, cung cấp REST API cho quản lý nghiệp vụ, xác thực, phân quyền, upload và tìm kiếm.',
    'Database: SQLite sử dụng better-sqlite3. Các bảng chính gồm books, customers, orders, order_items, suppliers, inventory_slips, inventory_transactions, documents, users, roles, permissions, role_permissions, audit_logs.',
    'Frontend: SPA tĩnh trong public/index.html, public/app.js, public/style.css với giao diện tiếng Việt theo nghiệp vụ nhà sách.',
    'Upload layer: multer lưu file vào thư mục uploads, kết hợp kiểm tra MIME/file signature và giới hạn kích thước.',
    'Text extraction layer: pdf-parse cho PDF, mammoth cho DOCX, tesseract.js cho OCR ảnh, TXT đọc trực tiếp.',
    'Search layer: SQLite FTS5 lập chỉ mục sách và tài liệu để tìm kiếm toàn văn.'
  ]],
  ['4. Trọng tâm quản trị dữ liệu phi cấu trúc', [
    'Dữ liệu phi cấu trúc trong đồ án được xem là tài liệu nghiệp vụ không có schema cố định. Mỗi tài liệu có thể là hóa đơn, hợp đồng, ảnh bìa, ghi chú kiểm kê, phản hồi khách hàng hoặc mô tả sách.',
    'Hệ thống không chỉ lưu file gốc mà còn quản lý vòng đời dữ liệu: tiếp nhận, xác thực, lưu trữ, gắn metadata, trích xuất text, lập chỉ mục, tìm kiếm, phân quyền, kiểm soát truy cập và ghi audit.',
    'Bảng documents lưu thông tin quan trọng: tên file, loại MIME, đường dẫn lưu trữ, nội dung text đã trích xuất, người upload, thời điểm upload/cập nhật, checksum, trạng thái OCR và lỗi xử lý nếu có.',
    'Checksum SHA-256 giúp nhận diện file, hỗ trợ kiểm soát tính toàn vẹn và giảm rủi ro quản lý trùng lặp/tài liệu giả mạo.',
    'Không expose thư mục uploads trực tiếp. Preview, download, detail và text đều đi qua API có xác thực và kiểm tra quyền.'
  ]],
  ['5. Quy trình xử lý tài liệu phi cấu trúc', [
    'Bước 1 - Upload: người dùng có quyền documents.upload tải file lên hệ thống. Hệ thống giới hạn kích thước file và loại file được hỗ trợ: TXT, PDF, DOCX, PNG, JPEG, WebP.',
    'Bước 2 - Kiểm tra an toàn: backend kiểm tra MIME, file signature, checksum và lưu metadata vào database.',
    'Bước 3 - Trích xuất nội dung: TXT đọc trực tiếp; PDF dùng pdf-parse; DOCX dùng mammoth; ảnh dùng OCR qua tesseract.js.',
    'Bước 4 - Lưu text và trạng thái: nội dung trích xuất được lưu trong documents.text_content, trạng thái OCR/processing_error hỗ trợ theo dõi lỗi xử lý.',
    'Bước 5 - Lập chỉ mục: nội dung tài liệu được đưa vào FTS để tìm kiếm nhanh theo từ khóa.',
    'Bước 6 - Khai thác: người dùng tìm kiếm, xem chi tiết, preview, download hoặc cập nhật metadata tùy quyền.',
    'Bước 7 - Quản trị: thao tác quan trọng được ghi audit log, quyền truy cập được kiểm soát bằng RBAC và ownership scope.'
  ]],
  ['6. Phân quyền dữ liệu phi cấu trúc', [
    'Các quyền liên quan tài liệu gồm documents.view, documents.view_all, documents.upload, documents.update và documents.delete.',
    'documents.view cho phép xem module tài liệu nhưng không đồng nghĩa với xem toàn bộ dữ liệu của người khác.',
    'documents.view_all cho phép xem toàn bộ tài liệu. Người không có quyền này chỉ thấy tài liệu do chính mình upload.',
    'Backend enforcement được áp dụng ở API list, detail, text, preview, download, update, delete và reprocess. Vì vậy người dùng không thể bypass bằng cách gọi API trực tiếp.',
    'Frontend chỉ là lớp trải nghiệm: ẩn menu/nút không đủ quyền, nhưng bảo mật chính nằm ở backend trả 401/403.'
  ]],
  ['7. RBAC và giao diện theo vai trò', [
    'Đồ án bổ sung ma trận quyền chi tiết thay vì chỉ dựa vào vai trò cứng. Các vai trò demo gồm admin, manager, sales, warehouse, accountant và document_staff.',
    'Sidebar được lọc theo quyền. Dashboard hiển thị nội dung phù hợp vai trò. Nút thêm/sửa/xóa/hủy/xuất báo cáo chỉ hiện khi có permission tương ứng.',
    'Màn hình Nhân viên & phân quyền có checkbox editor để quản lý role-permission trực quan.',
    'Backend dùng requirePermission thay cho role-only guard ở các API quan trọng.'
  ]],
  ['8. Ownership scope', [
    'Đồ án bổ sung created_by cho orders và customers, đồng thời dùng uploaded_by cho documents.',
    'Nếu người dùng không có *.view_all thì chỉ thấy dữ liệu của chính mình.',
    'Scope này áp dụng cho đơn hàng, khách hàng và tài liệu, phù hợp nguyên tắc least privilege trong quản trị dữ liệu.'
  ]],
  ['9. Dữ liệu mẫu và tính thực tế', [
    'Database hiện có dữ liệu giả thực tế cho nhà sách Việt Nam: sách, khách hàng, nhà cung cấp, đơn hàng, tồn kho, đánh giá, tài liệu và audit logs.',
    'Tài liệu mẫu trong uploads gồm hóa đơn nhập hàng, hợp đồng cung ứng, mô tả ảnh bìa, ghi chú kiểm kê, phản hồi khách hàng và mô tả sách.',
    'Dữ liệu này giúp demo đầy đủ luồng quản trị dữ liệu phi cấu trúc mà không dùng thông tin cá nhân thật.'
  ]],
  ['10. Những phần đã thực hiện trong quá trình phát triển', [
    'Seed dữ liệu nhà sách realistic mà không reset/xóa DB hiện tại.',
    'Cập nhật UI tiếng Việt theo nghiệp vụ nhà sách Bookstore.',
    'Bổ sung RBAC chi tiết, permission matrix, demo accounts và checkbox role-permission editor.',
    'Chuyển API sang kiểm tra permission ở backend và chuẩn hóa phản hồi 401/403.',
    'Bổ sung ownership scope cho orders, customers và documents.',
    'Bổ sung test API cho đăng nhập theo vai trò, RBAC và ownership scope.',
    'Chuẩn bị deploy demo với .env.example, DEPLOY.md, render.yaml, railway.json và health check /api/health.',
    'Deploy-ready với database SQLite và uploads mẫu được giữ nguyên để demo đúng dữ liệu giả hiện tại.'
  ]],
  ['11. Kiểm thử', [
    'node -c src/server.js: kiểm tra cú pháp backend.',
    'npm run rbac:test: kiểm tra đăng nhập, số lượng quyền và các API bị cấm trả 403 đúng.',
    'npm run scope:test: kiểm tra sales chỉ thấy đơn của mình, không xem được đơn admin tạo; admin vẫn xem toàn bộ.',
    'npm run e2e:roles: kiểm tra login cho 6 tài khoản demo và truy cập dashboard.',
    'npm run smoke: kiểm tra dashboard, books và search.',
    'npm run flow:test: kiểm tra luồng đơn hàng nhiều item, hủy đơn hoàn kho, phiếu kho và export CSV.',
    'npm run hardening:test: kiểm tra upload an toàn, text preview và permission matrix API.'
  ]],
  ['12. Tài khoản demo', [
    'admin@bookstore.local / Admin123! - Quản trị viên.',
    'manager@bookstore.local / Manager123! - Quản lý nhà sách.',
    'sales@bookstore.local / Sales123! - Nhân viên bán hàng.',
    'warehouse@bookstore.local / Warehouse123! - Nhân viên kho.',
    'accountant@bookstore.local / Accountant123! - Kế toán.',
    'documents@bookstore.local / Documents123! - Nhân viên tài liệu.'
  ]],
  ['13. Deploy demo', [
    'Repo GitHub: https://github.com/phi1411/kpdl_dlpct.',
    'Nền tảng đề xuất: Render Free để phục vụ demo đồ án.',
    'Build command: npm ci.',
    'Start command: npm start.',
    'Environment variables: NODE_ENV=production và JWT_SECRET=<chuỗi bí mật dài>.',
    'Health check: /api/health.',
    'Lưu ý: Render Free có filesystem không bảo đảm persistent lâu dài. Database ban đầu từ GitHub vẫn có sẵn; các thay đổi phát sinh sau deploy có thể mất khi restart/redeploy. Với demo đồ án dùng dữ liệu giả, phương án này phù hợp.'
  ]],
  ['14. Đánh giá và hạn chế', [
    'Ưu điểm: hệ thống thể hiện rõ quy trình quản trị dữ liệu phi cấu trúc từ upload đến khai thác tìm kiếm, đồng thời có RBAC và ownership scope.',
    'Ưu điểm: phù hợp bối cảnh nhà sách, giao diện tiếng Việt, có dữ liệu mẫu và tài khoản demo theo vai trò.',
    'Hạn chế: SQLite và local uploads phù hợp demo/MVP nhưng chưa phải kiến trúc production lớn.',
    'Hạn chế: OCR phụ thuộc chất lượng ảnh và tài nguyên server; bản demo chưa tối ưu queue xử lý nền.',
    'Hạn chế: free deploy không bảo đảm lưu bền các thay đổi runtime.'
  ]],
  ['15. Hướng phát triển', [
    'Chuyển database sang PostgreSQL để phù hợp triển khai production.',
    'Chuyển file storage sang S3/R2/Supabase Storage.',
    'Bổ sung pipeline xử lý tài liệu nền bằng queue để OCR không chặn request.',
    'Bổ sung phân loại tài liệu tự động theo loại hóa đơn/hợp đồng/ghi chú/phản hồi.',
    'Bổ sung dashboard phân tích dữ liệu phi cấu trúc: từ khóa phổ biến, phản hồi khách hàng, lỗi OCR, tài liệu chưa xử lý.',
    'Bổ sung kiểm thử browser E2E bằng Playwright hoặc Cypress.'
  ]],
  ['Kết luận', [
    'Đồ án đã xây dựng được một hệ thống MVP hoàn chỉnh cho quản lý nhà sách có tích hợp quản trị dữ liệu phi cấu trúc.',
    'Trọng tâm của hệ thống là biến tài liệu phi cấu trúc thành dữ liệu có thể quản lý: có metadata, text extraction, OCR, checksum, indexing, search, RBAC, ownership scope và audit.',
    'Hệ thống phù hợp để trình bày trong môn Quản trị dữ liệu phi cấu trúc vì thể hiện đầy đủ vòng đời dữ liệu từ tiếp nhận, lưu trữ, xử lý, tìm kiếm, bảo mật đến triển khai demo.'
  ]]
];

function p(text, style = '') {
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}
function heading(text, level) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;
}
function bullet(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

let body = '';
sections.forEach(([title, content], i) => {
  if (i === 0) {
    body += heading(title, 1);
    body += p(content, '<w:pPr><w:jc w:val="center"/></w:pPr>');
    body += p('Sinh viên: Phi');
    body += p('Ngày lập báo cáo: 27/05/2026');
  } else {
    body += heading(title, 2);
    for (const item of content) body += bullet(item);
  }
});

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style></w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

fs.writeFileSync(path.join(outDir, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
fs.writeFileSync(path.join(outDir, '_rels', '.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
fs.writeFileSync(path.join(outDir, 'word', '_rels', 'document.xml.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`);
fs.writeFileSync(path.join(outDir, 'word', 'document.xml'), documentXml);
fs.writeFileSync(path.join(outDir, 'word', 'styles.xml'), stylesXml);
fs.writeFileSync(path.join(outDir, 'word', 'numbering.xml'), numberingXml);
fs.writeFileSync(path.join(outDir, 'docProps', 'core.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"><dc:title>Báo cáo đồ án quản trị dữ liệu phi cấu trúc</dc:title><dc:creator>Phi</dc:creator><dc:subject>Bookstore</dc:subject></cp:coreProperties>`);
fs.writeFileSync(path.join(outDir, 'docProps', 'app.xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OpenClaw</Application></Properties>`);
fs.rmSync(outFile, { force: true });
const zipFile = `${outFile}.zip`;
fs.rmSync(zipFile, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipFile}' -Force`], { stdio: 'inherit' });
fs.renameSync(zipFile, outFile);
fs.rmSync(outDir, { recursive: true, force: true });
console.log(outFile);
