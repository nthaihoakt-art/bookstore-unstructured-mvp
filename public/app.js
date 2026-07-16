const apiBase = '';
let token = localStorage.token || '';
let user = null;
try {
  user = JSON.parse(localStorage.user || 'null');
} catch (e) {
  localStorage.removeItem('user');
  localStorage.removeItem('token');
  token = '';
}
let tab = localStorage.tab || 'dashboard';
let orderLines = [];
let slipLines = [];
let chatHistory = [];

let allBooks = [];
let bookCategories = [];
let bookFilters = { category: '', sort: 'default' };

let allOrders = [];
let orderFilters = { status: '', sort: 'date-desc' };

let allCustomers = [];
let customerFilters = { type: '', sort: 'name-asc' };
let activeCustomerSubTab = 'list';
let customerSegmentMap = {};
let activeAuditSubTab = 'audit';
const segmentColors = { 'VIP': '#d99a24', 'Khách thân thiết': '#17443b', 'Khách vãng lai': '#667085', 'Học sinh / Sinh viên': '#12805c' };

const roleLabels = { admin:'Quản trị viên', manager:'Quản lý nhà sách', sales:'Nhân viên bán hàng', warehouse:'Nhân viên kho', accountant:'Kế toán', document_staff:'Nhân viên tài liệu' };
const labels = { dashboard:'Tổng quan', books:'Sách', customers:'Khách hàng', orders:'Đơn hàng', inventory:'Kho sách', suppliers:'Nhà cung cấp', documents:'Tài liệu', feedbacks:'Phản hồi', search:'Tìm kiếm', reports:'Báo cáo', users:'Nhân viên & phân quyền', audit:'Nhật ký hoạt động', forbidden:'Không có quyền' };
const orderStatusLabels = { new: 'Mới', paid: 'Đã thanh toán', shipping: 'Đang giao hàng', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
const docTypeLabels = { invoice: 'Hóa đơn', contract: 'Hợp đồng', cover: 'Ảnh bìa', inventory_note: 'Ghi chú kho', customer_feedback: 'Phản hồi khách', book_description: 'Mô tả sách', internal: 'Nội bộ' };
const ocrStatusLabels = { done: 'Đã xử lý', failed: 'Thất bại', processing: 'Đang xử lý', not_required: 'Không yêu cầu' };
const customerTypeLabels = { retail: 'Khách lẻ', loyal: 'Khách thân thiết', wholesale: 'Khách sỉ' };
const routePerms = {
  dashboard:['reports.view_basic'], books:['books.view'], customers:['customers.view'], orders:['orders.view'], inventory:['inventory.view'], suppliers:['suppliers.view'], documents:['documents.view'], feedbacks:['books.view'], search:['search.use'], reports:['reports.view_basic','reports.view_financial'], users:['users.view','roles.manage'], audit:['audit_logs.view']
};
const menu = [
  ['dashboard','Tổng quan'], ['books','Sách'], ['customers','Khách hàng'], ['orders','Đơn hàng'], ['inventory','Kho sách'], ['suppliers','Nhà cung cấp'], ['documents','Tài liệu'], ['feedbacks','Phản hồi'], ['ai','AI Assistant'], ['search','Tìm kiếm'], ['reports','Báo cáo'], ['users','Nhân viên & phân quyền'], ['audit','Nhật ký hoạt động']
];
function perms(){ return user?.permissions || []; }
function has(...p){ const ps=perms(); return p.some(x=>ps.includes(x)); }
function canRoute(t){ return !routePerms[t] || has(...routePerms[t]); }
function firstAllowed(){ return menu.find(([k])=>canRoute(k))?.[0] || 'forbidden'; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function money(v){ return new Intl.NumberFormat('vi-VN').format(v||0)+'đ'; }
function app(html){
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = html;
}
function empty(text='Chưa có dữ liệu phù hợp.'){ return `<div class="empty">${esc(text)}</div>`; }
function field(id){ return document.getElementById(id); }
async function api(path,opt={}){ opt.headers={...(opt.headers||{}),Authorization:'Bearer '+token}; if(opt.body && !(opt.body instanceof FormData)){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(opt.body); } const r=await fetch(apiBase+path,opt); if(r.status===401){ localStorage.removeItem('token'); localStorage.removeItem('user'); token=''; user=null; render(); throw new Error('Hết phiên làm việc. Vui lòng đăng nhập lại.'); } const ct=r.headers.get('content-type')||''; const j=ct.includes('json')?await r.json().catch(()=>({})):{}; if(!r.ok) throw new Error(j.error || (r.status===403?'Bạn không có quyền truy cập chức năng này.':'Không thể tải dữ liệu.')); return j; }
async function login(){ try{ field('err').textContent='Đang đăng nhập...'; const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:field('email').value,password:field('password').value})}).then(async x=>{const j=await x.json(); if(!x.ok) throw new Error(j.error); return j;}); token=r.token; user=r.user; localStorage.token=token; localStorage.user=JSON.stringify(user); tab='dashboard'; localStorage.tab=tab; render(); }catch(e){ field('err').textContent=e.message || 'Đăng nhập không thành công.'; } }
function logout(){ localStorage.clear(); token=''; user=null; tab='dashboard'; render(); }
function go(t){ tab=t; localStorage.tab=t; render(); }
function roleHomeTitle(){ return {admin:'Tổng quan quản trị hệ thống',manager:'Tổng quan quản lý nhà sách',sales:'Tổng quan bán hàng',warehouse:'Tổng quan kho sách',accountant:'Tổng quan tài chính',document_staff:'Tổng quan tài liệu'}[user?.role] || 'Tổng quan'; }
function shell(content){ const nav=menu.filter(([k])=>canRoute(k)); app(`<div class="layout"><aside class="side"><div class="brand">🌿 Bookstore</div><div class="userbox"><b>${esc(user.fullName)}</b><br><span>${esc(roleLabels[user.role]||user.role)}</span></div><div class="nav">${nav.map(([k,v])=>`<button class="${tab===k?'active':''}" onclick="go('${k}')">${esc(k==='dashboard'?roleHomeTitle():v)}</button>`).join('')}</div></aside><main class="main"><div class="top"><div><h2>${esc(tab==='dashboard'?roleHomeTitle():(labels[tab]||'Bookstore'))}</h2><p class="muted">Giao diện và quyền thao tác được lọc theo vai trò đăng nhập.</p></div><button class="ghost" onclick="logout()">Đăng xuất</button></div>${content}</main></div>`); }
function segmentPill(seg){ if(!seg) return '-'; const color=segmentColors[seg]||'#667085'; return `<span class="pill" style="background:${color};color:white">${esc(seg)}</span>`; }
function customerSubTabsHtml(){ return `<div class="sub-tabs"><button class="sub-tab-btn ${activeCustomerSubTab==='list'?'active':''}" onclick="switchCustomerTab('list')">Danh sách khách hàng</button><button class="sub-tab-btn ${activeCustomerSubTab==='segments'?'active':''}" onclick="switchCustomerTab('segments')">Phân khúc khách hàng (AI)</button></div>`; }
function switchCustomerTab(t){ activeCustomerSubTab=t; renderCustomersList(); }
function auditSubTabsHtml(){ return `<div class="sub-tabs"><button class="sub-tab-btn ${activeAuditSubTab==='audit'?'active':''}" onclick="switchAuditTab('audit')">Nhật ký kiểm tra (Audit Logs)</button><button class="sub-tab-btn ${activeAuditSubTab==='files'?'active':''}" onclick="switchAuditTab('files')">Tệp nhật ký (Log Files)</button></div>`; }
function switchAuditTab(t){ activeAuditSubTab=t; auditLogs(); }
function forbidden(){ shell(`<div class="card error"><h3>403 - Bạn không có quyền truy cập chức năng này.</h3><p>Vui lòng quay lại menu được cấp quyền hoặc liên hệ quản trị viên nếu cần thêm quyền.</p></div>`); }
function table(rows,headers={}){ if(!rows?.length) return empty(); const keys=Object.keys(rows[0]); return `<div class="tablewrap"><table><thead><tr>${keys.map(k=>`<th>${esc(headers[k]||k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${keys.map(k=>`<td>${r[k] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
async function render(){ if(!token||!user) return app(`<div class="login card"><h2>Đăng nhập hệ thống nhà sách</h2><p class="muted">Chọn tài khoản demo theo vai trò để kiểm tra RBAC.</p><div id="err" class="error" style="min-height:20px"></div><label>Email nhân viên</label><p><input id="email" value="admin@bookstore.local" style="width:100%"></p><label>Mật khẩu</label><p><input id="password" type="password" value="Admin123!" style="width:100%"></p><button class="primary" onclick="login()">Đăng nhập</button><p class="muted">Demo: admin/manager/sales/warehouse/accountant/documents @bookstore.local</p></div>`); if(!canRoute(tab)) tab=firstAllowed(); try{ if(!canRoute(tab)) return forbidden(); if(tab==='dashboard') return await dashboard(); if(tab==='books') return await books(); if(tab==='customers') return await customers(); if(tab==='orders') return await orders(); if(tab==='inventory') return await inventory(); if(tab==='suppliers') return await suppliers(); if(tab==='documents') return await documents(); if(tab==='feedbacks') return await feedbacks(); if(tab==='search') return await search(); if(tab==='ai') return await aiAssistant(); if(tab==='reports') return await reports(); if(tab==='users') return await users(); if(tab==='audit') return await auditLogs(); }catch(e){ if(!token||!user) return render(); if(String(e.message).includes('quyền')) return forbidden(); shell(`<div class="error">${esc(e.message)}</div>`); } }
async function dashboard(){ const d=await api('/api/dashboard'); const role=user.role; const cards={admin:[['Sách',d.totals.books],['Khách hàng',d.totals.customers],['Đơn hàng',d.totals.orders],['Tài liệu',d.totals.documents],['Doanh thu',money(d.totals.revenue)],['Sắp hết hàng',d.totals.lowStock]], manager:[['Doanh thu',money(d.totals.revenue)],['Đơn hàng',d.totals.orders],['Khách hàng',d.totals.customers],['Sách sắp hết',d.totals.lowStock],['Tài liệu mới',d.totals.documents]], sales:[['Đơn hàng',d.totals.orders],['Khách hàng',d.totals.customers],['Sách để tư vấn',d.totals.books]], warehouse:[['Sách trong kho',d.totals.books],['Sách sắp hết',d.totals.lowStock],['Tài liệu kho',d.totals.documents]], accountant:[['Doanh thu',money(d.totals.revenue)],['Đơn hàng',d.totals.orders],['Tài liệu hóa đơn',d.totals.documents]], document_staff:[['Tài liệu đã lưu',d.totals.documents],['Sách liên quan',d.totals.books],['Đơn hàng liên quan',d.totals.orders]]}[role] || [];
  const docTypesTranslated = (d.documentTypes || []).map(t => ({ doc_type: docTypeLabels[t.doc_type] || t.doc_type, count: t.count }));
  shell(`<div class="grid">${cards.map(([k,v])=>`<div class="stat"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}</div>${has('inventory.view')?`<div class="card"><h3>Cảnh báo sách sắp hết hàng</h3>${table(d.lowStock,{code:'Mã sách',title:'Tên sách',stock_quantity:'Tồn kho'})}</div>`:''}${has('reports.view_basic')?`<div class="card"><h3>Sách bán chạy</h3>${table(d.topBooks,{title:'Tên sách',qty:'Số lượng bán',revenue:'Doanh thu'})}</div>`:''}${has('documents.view')?`<div class="card"><h3>Tài liệu theo loại</h3>${table(docTypesTranslated,{doc_type:'Loại tài liệu',count:'Số lượng'})}</div>`:''}`); }
async function books(){
  const [rows, categories] = await Promise.all([api('/api/books'), api('/api/categories')]);
  allBooks = rows;
  bookCategories = categories;
  renderBooksList();
}
function renderBooksList() {
  const categoryOptions = bookCategories.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  const form=has('books.create','books.update')?`<div class="card"><h3>${has('books.create')?'Thêm / cập nhật sách':'Cập nhật sách'}</h3><input type="hidden" id="b_id"><div class="form"><input id="b_code" placeholder="Mã sách (chỉ nhập số)"><input id="b_title" placeholder="Tên sách"><input id="b_author" placeholder="Tác giả"><select id="b_category"><option value="">-- Chọn thể loại --</option>${categoryOptions}</select><input id="b_publisher" placeholder="Nhà xuất bản"><input id="b_isbn" placeholder="ISBN"><input id="b_sale_price" type="number" placeholder="Giá bán"><input id="b_stock_quantity" type="number" placeholder="Tồn kho"><textarea class="full" id="b_description" placeholder="Mô tả tư vấn"></textarea><button class="primary" onclick="saveBook()">Lưu thay đổi</button></div></div>`:'';
  
  let filtered = [...allBooks];
  if(bookFilters.category) {
    filtered = filtered.filter(b => b.category === bookFilters.category);
  }
  
  filtered.sort((a, b) => {
    if(bookFilters.sort === 'title-asc') return a.title.localeCompare(b.title, 'vi');
    if(bookFilters.sort === 'title-desc') return b.title.localeCompare(a.title, 'vi');
    if(bookFilters.sort === 'price-asc') return a.sale_price - b.sale_price;
    if(bookFilters.sort === 'price-desc') return b.sale_price - a.sale_price;
    if(bookFilters.sort === 'stock-asc') return a.stock_quantity - b.stock_quantity;
    if(bookFilters.sort === 'stock-desc') return b.stock_quantity - a.stock_quantity;
    return a.id - b.id;
  });
  
  const filterSection = `
    <div class="table-controls">
      <div class="control-group">
        <label>Thể loại:</label>
        <select onchange="bookFilters.category=this.value; renderBooksList()">
          <option value="">Tất cả thể loại</option>
          ${bookCategories.map(c => `<option value="${esc(c.name)}" ${bookFilters.category===c.name?'selected':''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="control-group">
        <label>Sắp xếp:</label>
        <select onchange="bookFilters.sort=this.value; renderBooksList()">
          <option value="default" ${bookFilters.sort==='default'?'selected':''}>Mặc định</option>
          <option value="title-asc" ${bookFilters.sort==='title-asc'?'selected':''}>Tên sách (A-Z)</option>
          <option value="title-desc" ${bookFilters.sort==='title-desc'?'selected':''}>Tên sách (Z-A)</option>
          <option value="price-asc" ${bookFilters.sort==='price-asc'?'selected':''}>Giá bán (Tăng dần)</option>
          <option value="price-desc" ${bookFilters.sort==='price-desc'?'selected':''}>Giá bán (Giảm dần)</option>
          <option value="stock-asc" ${bookFilters.sort==='stock-asc'?'selected':''}>Tồn kho (Tăng dần)</option>
          <option value="stock-desc" ${bookFilters.sort==='stock-desc'?'selected':''}>Tồn kho (Giảm dần)</option>
        </select>
      </div>
    </div>
  `;
  
  const listCard = `<div class="card">
    <h3>Danh sách sách</h3>
    ${filterSection}
    ${table(filtered.map(r=>({'Mã':esc(r.code),'Tên sách':`<a href="#" onclick="bookDetail(${r.id}); return false;" style="${r.is_active? '' : 'color:var(--muted);text-decoration:line-through'}">${esc(r.title)}</a>${r.is_active? '' : ' <span class="pill danger">Ngưng bán</span>'}`, 'Tác giả':esc(r.author),'Thể loại':esc(r.category),'Giá bán':r.is_active? money(r.sale_price) : `<span class="muted" style="text-decoration:line-through">${money(r.sale_price)}</span>`,'Tồn kho':r.is_active? r.stock_quantity : `<span class="muted">${r.stock_quantity}</span>`,'Thao tác':`<button class="ghost" onclick="bookDetail(${r.id})">Xem</button> ${has('books.update')?`<button class="ghost" onclick="editBook(${r.id})">Sửa</button>`:''} ${has('books.delete')?`<button class="ghost danger" onclick="delBook(${r.id})">Xóa</button>`:''}`})))}
  </div>`;
  shell(`${form}${listCard}<div id="detail"></div>`);
}
async function editBook(id){ const b=await api('/api/books/'+id); ['id','code','title','author','category','publisher','isbn','sale_price','stock_quantity','description'].forEach(k=>{const el=field('b_'+k); if(el) { if (k === 'code') el.value = (b[k]||'').replace(/^BOOK-/, ''); else el.value = b[k]||''; }}); const firstEl = field('b_code') || field('b_title'); if (firstEl) { firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstEl.focus(); } }
async function saveBook(){ try { const id=field('b_id').value; const codeVal=field('b_code').value.trim(); if(!/^\d+$/.test(codeVal)){ return alert('Mã sách chỉ được phép nhập số (tiền tố BOOK- sẽ tự động được thêm)'); } const body={code:'BOOK-'+codeVal,title:field('b_title').value,author:field('b_author').value,category:field('b_category').value,publisher:field('b_publisher').value,isbn:field('b_isbn').value,sale_price:Number(field('b_sale_price').value||0),stock_quantity:Number(field('b_stock_quantity').value||0),description:field('b_description').value,tags:[]}; if (body.sale_price < 0 || body.stock_quantity < 0) { return alert('Giá bán và số lượng tồn kho không được là số âm!'); } await api(id?'/api/books/'+id:'/api/books',{method:id?'PUT':'POST',body}); books(); } catch (e) { alert('Lỗi khi lưu sách: ' + e.message); } }
async function delBook(id){ if(confirm('Xóa sách này?')){ try { await api('/api/books/'+id,{method:'DELETE'}); books(); } catch (e) { alert('Lỗi khi xóa sách: ' + e.message); } } }
async function bookDetail(id){ try { const b=await api('/api/books/'+id); const docs = (b.documents || []).map(d => ({ 'Mã': d.id, 'Tên tài liệu': `<a href="#" onclick="docDetail(${d.id}); return false;">${esc(d.original_name)}</a>`, 'Loại': docTypeLabels[d.doc_type] || d.doc_type, 'Tiêu đề': esc(d.title || ''), 'Ngày tạo': d.created_at })); const el = field('detail'); if(el) {
  let coverHtml = '';
  if (b.cover_document_id) {
    const tokenParam = '?token=' + encodeURIComponent(token);
    coverHtml = `<div class="book-detail-cover"><img src="/api/documents/${b.cover_document_id}/preview${tokenParam}" alt="Ảnh bìa ${esc(b.title)}"></div>`;
  } else {
    coverHtml = `<div class="book-detail-cover no-cover"><span>Chưa có ảnh bìa</span></div>`;
  }
  el.innerHTML=`<div class="card">
    <div class="book-detail-layout">
      ${coverHtml}
      <div class="book-detail-info">
        <h3>${esc(b.title)}</h3>
        <div class="book-meta-grid">
          <p><b>Mã sách:</b> ${esc(b.code)}</p>
          <p><b>Tác giả:</b> ${esc(b.author || 'Chưa cập nhật')}</p>
          <p><b>Thể loại:</b> ${esc(b.category || 'Chưa cập nhật')}</p>
          <p><b>NXB:</b> ${esc(b.publisher || 'Chưa cập nhật')}</p>
          <p><b>ISBN:</b> ${esc(b.isbn || 'Chưa cập nhật')}</p>
          <p><b>Giá bán:</b> <span class="price-highlight">${money(b.sale_price)}</span></p>
          <p><b>Tồn kho:</b> <span class="stock-highlight">${b.stock_quantity} cuốn</span></p>
        </div>
        <div class="book-description-section">
          <h4>Giới thiệu & Mô tả sách</h4>
          <p class="description-text">${esc(b.description || 'Chưa có mô tả cho sách này. Bạn có thể cập nhật bằng cách upload file Mô tả sách và liên kết với sách.')}</p>
        </div>
      </div>
    </div>
    <div class="book-related-docs" style="margin-top: 30px;">
      <h4>Tài liệu liên quan</h4>
      ${table(docs)}
    </div>
  </div>`;
  el.scrollIntoView({ behavior: 'smooth' });
} } catch (e) { alert('Lỗi hiển thị chi tiết sách: ' + e.message); } }
async function customers(){
  allCustomers = await api('/api/customers');
  try {
    const data = await api('/api/customers/segments');
    customerSegmentMap = {};
    (data.segments || []).forEach(s => { customerSegmentMap[String(s.id)] = s.segment; });
    window._customerSegmentsData = data;
  } catch (e) {
    customerSegmentMap = {};
    window._customerSegmentsData = null;
  }
  renderCustomersList();
}
async function showCustomerSegments() {
  try {
    const data = window._customerSegmentsData || await api('/api/customers/segments');
    const summary = data.summary || {};
    const segNames = ['VIP', 'Khách thân thiết', 'Khách vãng lai', 'Học sinh / Sinh viên'];
    let html = customerSubTabsHtml();
    html += '<div class="card segment-info"><h3>📊 Phân khúc khách hàng bằng Machine Learning (K-Means)</h3><p class="muted">Hệ thống tự động phân nhóm khách hàng dựa trên Tổng chi tiêu và Tần suất mua hàng (Số đơn hàng).</p></div>';
    segNames.forEach(seg => {
      const info = summary[seg];
      if (!info || !info.count) return;
      const color = segmentColors[seg] || '#667085';
      html += `<div class="card segment-card" style="border-left:4px solid ${color}">
        <div class="segment-header">
          <h3 style="color:${color}">${esc(seg)}</h3>
          <span class="member-badge">${info.count} thành viên</span>
        </div>
        <p class="muted segment-summary">Tổng chi tiêu của nhóm: ${money(info.total_spent)} | Tổng đơn hàng: ${info.total_orders}</p>
        ${table((info.customers || []).map(c => ({ 'ID': c.id, 'Họ tên': esc(c.full_name), 'Tổng chi tiêu': money(c.total_spent), 'Số đơn hàng': c.order_count })))}
      </div>`;
    });
    if (!segNames.some(seg => summary[seg]?.count)) {
      html += empty('Chưa đủ dữ liệu để phân khúc khách hàng.');
    }
    shell(html + '<div id="detail"></div>');
  } catch (e) {
    shell(customerSubTabsHtml() + `<div class="error">Lỗi tải phân khúc: ${esc(e.message)}</div>`);
  }
}
function renderCustomersList() {
  if (activeCustomerSubTab === 'segments') return showCustomerSegments();
  const form=has('customers.create','customers.update')?`<div class="card"><h3>Khách hàng</h3><input type="hidden" id="c_id"><div class="form"><input id="c_full_name" placeholder="Họ tên"><input id="c_phone" placeholder="Điện thoại"><input id="c_email" placeholder="Email"><select id="c_type"><option value="retail">Khách lẻ</option><option value="loyal">Khách thân thiết</option><option value="wholesale">Khách sỉ</option></select><textarea class="full" id="c_notes" placeholder="Ghi chú"></textarea><button class="primary" onclick="saveCustomer()">Lưu khách hàng</button></div></div>`:'';
  
  let filtered = [...allCustomers];
  if(customerFilters.type) {
    filtered = filtered.filter(c => c.type === customerFilters.type);
  }
  
  filtered.sort((a, b) => {
    if(customerFilters.sort === 'name-asc') return a.full_name.localeCompare(b.full_name, 'vi');
    if(customerFilters.sort === 'name-desc') return b.full_name.localeCompare(a.full_name, 'vi');
    if(customerFilters.sort === 'id-desc') return b.id - a.id;
    if(customerFilters.sort === 'id-asc') return a.id - b.id;
    return 0;
  });
  
  const filterSection = `
    <div class="table-controls">
      <div class="control-group">
        <label>Nhóm khách:</label>
        <select onchange="customerFilters.type=this.value; renderCustomersList()">
          <option value="">Tất cả nhóm</option>
          ${Object.entries(customerTypeLabels).map(([k, v]) => `<option value="${k}" ${customerFilters.type===k?'selected':''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="control-group">
        <label>Sắp xếp:</label>
        <select onchange="customerFilters.sort=this.value; renderCustomersList()">
          <option value="name-asc" ${customerFilters.sort==='name-asc'?'selected':''}>Họ tên (A-Z)</option>
          <option value="name-desc" ${customerFilters.sort==='name-desc'?'selected':''}>Họ tên (Z-A)</option>
          <option value="id-desc" ${customerFilters.sort==='id-desc'?'selected':''}>Mới nhất</option>
          <option value="id-asc" ${customerFilters.sort==='id-asc'?'selected':''}>Cũ nhất</option>
        </select>
      </div>
    </div>
  `;
  
  const listCard = `<div class="card">
    <h3>Danh sách khách hàng</h3>
    ${filterSection}
    ${table(filtered.map(r=>({'Mã':r.id,'Họ tên':`<a href="#" onclick="customerDetail(${r.id})">${esc(r.full_name)}</a>`,'Điện thoại':esc(r.phone),'Email':esc(r.email),'Nhóm':customerTypeLabels[r.type] || r.type,'Phân khúc (AI)':segmentPill(customerSegmentMap[String(r.id)]),'Thao tác':`${has('customers.update')?`<button class="ghost" onclick="editCustomer(${r.id})">Sửa</button>`:''} ${has('customers.delete')?`<button class="ghost danger" onclick="delCustomer(${r.id})">Xóa</button>`:''}`})))}
  </div>`;
  shell(`${customerSubTabsHtml()}${form}${listCard}<div id="detail"></div>`);
}
async function saveCustomer(){ try { const fullName = field('c_full_name').value.trim(); if (!fullName) { return alert('Họ tên khách hàng không được để trống!'); } const phone = field('c_phone').value.trim(); if (phone && !/^\d{9,11}$/.test(phone)) { return alert('Số điện thoại không hợp lệ (phải từ 9 đến 11 chữ số)!'); } const email = field('c_email').value.trim(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return alert('Email không đúng định dạng!'); } const body={full_name:fullName,phone:phone||null,email:email||null,type:field('c_type').value,notes:field('c_notes').value}; const id=field('c_id').value; await api(id?'/api/customers/'+id:'/api/customers',{method:id?'PUT':'POST',body}); customers(); } catch (e) { alert('Lỗi khi lưu khách hàng: ' + e.message); } }
async function editCustomer(id){ const c=await api('/api/customers/'+id); ['id','full_name','phone','email','type','notes'].forEach(k=>{const el=field('c_'+k); if(el) el.value=c[k]||'';}); const firstEl = field('c_full_name'); if (firstEl) { firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstEl.focus(); } }
async function delCustomer(id){ if(confirm('Xóa khách hàng này?')){ try { await api('/api/customers/'+id,{method:'DELETE'}); customers(); } catch (e) { alert('Lỗi khi xóa khách hàng: ' + e.message); } } }
async function customerDetail(id){ try { const c=await api('/api/customers/'+id); const el = field('detail'); if(el) { el.innerHTML=`<div class="card"><h3>${esc(c.full_name)}</h3><p>${esc(c.phone)} | ${esc(c.email)}</p><h4>Lịch sử mua hàng</h4>${table(c.orders)}</div>`; el.scrollIntoView({ behavior: 'smooth' }); } } catch (e) { alert('Lỗi hiển thị chi tiết khách hàng: ' + e.message); } }
async function orders(){
  allOrders = await api('/api/orders');
  renderOrdersList();
}
function renderOrdersList() {
  const form=has('orders.create')?`<div class="card"><h3>Tạo đơn hàng</h3><div class="form"><input id="o_customer_id" type="number" placeholder="ID khách hàng"><input id="o_channel" placeholder="Kênh bán" value="store"><textarea class="full" id="o_notes" placeholder="Ghi chú đơn hàng"></textarea><button class="ghost" onclick="addOrderLine()">Thêm dòng sách</button><button class="primary" onclick="saveOrder()">Tạo đơn</button></div><div id="orderLines"></div></div>`:'';
  
  let filtered = [...allOrders];
  if(orderFilters.status) {
    filtered = filtered.filter(o => o.status === orderFilters.status);
  }
  
  filtered.sort((a, b) => {
    if(orderFilters.sort === 'total-asc') return a.total - b.total;
    if(orderFilters.sort === 'total-desc') return b.total - a.total;
    if(orderFilters.sort === 'date-asc') return a.created_at.localeCompare(b.created_at);
    if(orderFilters.sort === 'date-desc') return b.created_at.localeCompare(a.created_at);
    return 0;
  });
  
  const filterSection = `
    <div class="table-controls">
      <div class="control-group">
        <label>Trạng thái:</label>
        <select onchange="orderFilters.status=this.value; renderOrdersList()">
          <option value="">Tất cả trạng thái</option>
          ${Object.entries(orderStatusLabels).map(([k, v]) => `<option value="${k}" ${orderFilters.status===k?'selected':''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="control-group">
        <label>Sắp xếp:</label>
        <select onchange="orderFilters.sort=this.value; renderOrdersList()">
          <option value="date-desc" ${orderFilters.sort==='date-desc'?'selected':''}>Ngày tạo (Mới nhất)</option>
          <option value="date-asc" ${orderFilters.sort==='date-asc'?'selected':''}>Ngày tạo (Cũ nhất)</option>
          <option value="total-desc" ${orderFilters.sort==='total-desc'?'selected':''}>Tổng tiền (Giảm dần)</option>
          <option value="total-asc" ${orderFilters.sort==='total-asc'?'selected':''}>Tổng tiền (Tăng dần)</option>
        </select>
      </div>
    </div>
  `;
  
  const listCard = `<div class="card">
    <h3>Danh sách đơn hàng</h3>
    ${filterSection}
    ${table(filtered.map(r=>({'Mã đơn':r.order_code,'Khách hàng':esc(r.customer_name),'Trạng thái':orderStatusLabels[r.status] || r.status,'Tổng tiền':money(r.total),'Ngày tạo':r.created_at,'Thao tác':`<button class="ghost" onclick="orderDetail(${r.id})">Xem</button> ${has('orders.cancel')?`<button class="ghost danger" onclick="cancelOrder(${r.id})">Hủy đơn</button>`:''}`})))}
  </div>`;
  shell(`${form}${listCard}<div id="detail"></div>`);
  drawOrderLines();
}
function addOrderLine(){ orderLines.push({book_id:'',quantity:1,unit_price:0}); drawOrderLines(); }
function drawOrderLines(){ const el=field('orderLines'); if(!el) return; el.innerHTML=orderLines.map((l,i)=>`<p><input placeholder="ID sách" type="number" value="${l.book_id}" onchange="orderLines[${i}].book_id=Number(this.value)"> <input type="number" value="${l.quantity}" onchange="orderLines[${i}].quantity=Number(this.value)"> <input type="number" placeholder="Đơn giá" value="${l.unit_price}" onchange="orderLines[${i}].unit_price=Number(this.value)"></p>`).join('') || '<p class="muted">Chưa có dòng sách.</p>'; }
async function saveOrder(){ try { if (!orderLines.length) { return alert('Đơn hàng phải có ít nhất một cuốn sách!'); } for (const item of orderLines) { if (!item.book_id || item.book_id <= 0) { return alert('Mã ID sách không hợp lệ!'); } if (!item.quantity || item.quantity <= 0) { return alert('Số lượng sách phải lớn hơn 0!'); } if (item.unit_price < 0) { return alert('Đơn giá không được là số âm!'); } } await api('/api/orders',{method:'POST',body:{customer_id:Number(field('o_customer_id').value||0)||null,channel:field('o_channel').value,notes:field('o_notes').value,items:orderLines}}); orderLines=[]; orders(); } catch (e) { alert('Lỗi khi tạo đơn hàng: ' + e.message); } }
async function orderDetail(id){ try { const o=await api('/api/orders/'+id); const el = field('detail'); if(el) { el.innerHTML=`<div class="card"><h3>${esc(o.order_code)}</h3><p>${esc(o.customer_name)} | ${orderStatusLabels[o.status] || o.status} | ${money(o.total)}</p>${table(o.items,{book_title:'Sách',quantity:'SL',unit_price:'Đơn giá',total:'Thành tiền'})}</div>`; el.scrollIntoView({ behavior: 'smooth' }); } } catch (e) { alert('Lỗi hiển thị chi tiết đơn hàng: ' + e.message); } }
async function cancelOrder(id){ if(confirm('Hủy đơn và hoàn tồn kho?')){ try { await api('/api/orders/'+id+'/cancel',{method:'POST',body:{reason:'Hủy từ giao diện'}}); orders(); } catch (e) { alert('Lỗi khi hủy đơn hàng: ' + e.message); } } }
async function inventory(){ const rows=await api('/api/inventory'); const form=has('inventory.import','inventory.export','inventory.adjust')?`<div class="card"><h3>Tạo phiếu kho</h3><div class="form"><select id="sl_type"><option value="in">Nhập kho</option><option value="out">Xuất kho</option><option value="adjust">Điều chỉnh</option></select><input id="sl_supplier_id" type="number" placeholder="ID nhà cung cấp"><textarea class="full" id="sl_note" placeholder="Ghi chú"></textarea><button class="ghost" onclick="addSlipLine()">Thêm dòng</button><button class="primary" onclick="saveSlip()">Lưu phiếu kho</button></div><div id="slipLines"></div></div>`:''; shell(`${form}<div class="card"><h3>Tồn kho</h3>${table(rows.map(r=>({'ID sách':r.book_id,'Mã':esc(r.code),'Tên sách':esc(r.title),'Tồn kho':r.stock_quantity,'Giá nhập':money(r.import_price),'Giá bán':money(r.sale_price),'Thể loại':esc(r.category)})))}</div>`); drawSlipLines(); }
function addSlipLine(){ slipLines.push({book_id:'',quantity:1,unit_cost:0}); drawSlipLines(); }
function drawSlipLines(){ const el=field('slipLines'); if(!el) return; el.innerHTML=slipLines.map((l,i)=>`<p><input type="number" placeholder="ID sách" value="${l.book_id}" onchange="slipLines[${i}].book_id=Number(this.value)"> <input type="number" value="${l.quantity}" onchange="slipLines[${i}].quantity=Number(this.value)"> <input type="number" placeholder="Giá vốn" value="${l.unit_cost}" onchange="slipLines[${i}].unit_cost=Number(this.value)"></p>`).join('') || '<p class="muted">Chưa có dòng kho.</p>'; }
async function saveSlip(){ try { if (!slipLines.length) { return alert('Phiếu kho phải có ít nhất một dòng sản phẩm!'); } for (const item of slipLines) { if (!item.book_id || item.book_id <= 0) { return alert('Mã ID sách không hợp lệ!'); } if (item.quantity === 0) { return alert('Số lượng điều chỉnh/nhập/xuất không được bằng 0!'); } if (item.unit_cost < 0) { return alert('Giá vốn nhập kho không được là số âm!'); } } await api('/api/inventory/slips',{method:'POST',body:{type:field('sl_type').value,supplier_id:Number(field('sl_supplier_id').value||0)||undefined,note:field('sl_note').value,items:slipLines}}); slipLines=[]; inventory(); } catch (e) { alert('Lỗi khi lưu phiếu kho: ' + e.message); } }
async function suppliers(){ const rows=await api('/api/suppliers'); const form=has('suppliers.create','suppliers.update')?`<div class="card"><h3>Nhà cung cấp</h3><input type="hidden" id="s_id"><div class="form"><input id="s_name" placeholder="Tên nhà cung cấp"><input id="s_contact_name" placeholder="Người liên hệ"><input id="s_phone" placeholder="Điện thoại"><input id="s_email" placeholder="Email"><input id="s_address" placeholder="Địa chỉ"><button class="primary" onclick="saveSupplier()">Lưu NCC</button></div></div>`:''; shell(`${form}<div class="card"><h3>Danh sách nhà cung cấp</h3>${table(rows.map(r=>({'Mã':r.id,'Tên':esc(r.name),'Liên hệ':esc(r.contact_name),'Điện thoại':esc(r.phone),'Email':esc(r.email),'Thao tác':`${has('suppliers.update')?`<button class="ghost" onclick="editSupplier(${r.id})">Sửa</button>`:''} ${has('suppliers.delete')?`<button class="ghost danger" onclick="delSupplier(${r.id})">Xóa</button>`:''}`})))}</div>`); }
async function saveSupplier(){ try { const name = field('s_name').value.trim(); if (!name) { return alert('Tên nhà cung cấp không được để trống!'); } const phone = field('s_phone').value.trim(); if (phone && !/^\d{9,11}$/.test(phone)) { return alert('Số điện thoại không hợp lệ (phải từ 9 đến 11 chữ số)!'); } const email = field('s_email').value.trim(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return alert('Email không đúng định dạng!'); } const id=field('s_id').value; const body={name:name,contact_name:field('s_contact_name').value,phone:phone||null,email:email||null,address:field('s_address').value,notes:'',rating:3}; await api(id?'/api/suppliers/'+id:'/api/suppliers',{method:id?'PUT':'POST',body}); suppliers(); } catch (e) { alert('Lỗi khi lưu nhà cung cấp: ' + e.message); } }
async function editSupplier(id){ const s=await api('/api/suppliers/'+id); ['id','name','contact_name','phone','email','address'].forEach(k=>{const el=field('s_'+k); if(el) el.value=s[k]||'';}); const firstEl = field('s_name'); if (firstEl) { firstEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstEl.focus(); } }
async function delSupplier(id){ if(confirm('Xóa nhà cung cấp này?')){ try { await api('/api/suppliers/'+id,{method:'DELETE'}); suppliers(); } catch (e) { alert('Lỗi khi xóa nhà cung cấp: ' + e.message); } } }
async function documents(){ const rows=await api('/api/documents'); const form=has('documents.upload')?`<div class="card"><h3>Tải tài liệu lên</h3><div class="form"><input id="d_file" type="file"><select id="d_type"><option value="auto">Tự động phân loại</option><option value="invoice">Hóa đơn</option><option value="contract">Hợp đồng</option><option value="cover">Ảnh bìa</option><option value="inventory_note">Ghi chú kho</option><option value="customer_feedback">Phản hồi khách</option><option value="book_description">Mô tả sách</option><option value="internal">Nội bộ</option></select><select id="d_entity"><option value="">Không liên kết</option><option value="book">Sách</option><option value="order">Đơn hàng</option><option value="supplier">Nhà cung cấp</option><option value="customer">Khách hàng</option><option value="inventory_slip">Phiếu kho</option></select><input id="d_entity_id" type="number" placeholder="ID liên kết"><textarea class="full" id="d_notes" placeholder="Ghi chú"></textarea><button class="primary" onclick="uploadDoc()">Tải tài liệu lên</button></div></div>`:''; shell(`${form}<div class="card"><h3>Kho tài liệu</h3>${table(rows.map(r=>({'Mã':r.id,'Tên tài liệu':`<a href="#" onclick="docDetail(${r.id}); return false;">${esc(r.original_name)}</a>`,'Loại':docTypeLabels[r.doc_type] || r.doc_type,'Liên kết':esc((r.entity_type||'')+' '+(r.entity_id||'')),'Ghi chú':esc(r.notes||''),'Trạng thái':ocrStatusLabels[r.ocr_status] || r.ocr_status,'Thao tác':`<button class="ghost" onclick="docDetail(${r.id}, this)">Xem</button> ${has('documents.update')?`<button class="ghost" onclick="reprocessDoc(${r.id}, this)">OCR lại</button>`:''} ${has('documents.delete')?`<button class="ghost danger" onclick="delDoc(${r.id}, this)">Xóa</button>`:''}`})))}</div><div id="detail"></div>`); }
async function uploadDoc(){ try { const f=field('d_file').files[0]; if(!f) return alert('Vui lòng chọn file.'); const fd=new FormData(); fd.append('file',f); fd.append('doc_type',field('d_type').value); fd.append('entity_type',field('d_entity').value); fd.append('entity_id',field('d_entity_id').value); fd.append('title',''); fd.append('tags',''); fd.append('notes',field('d_notes').value); await api('/api/documents',{method:'POST',body:fd}); documents(); } catch (e) { alert('Lỗi khi tải tài liệu: ' + e.message); } }
async function docDetail(id, btn){
  const oldText = btn ? btn.textContent : '';
  if (btn) {
    btn.textContent = 'Đang tải...';
    btn.disabled = true;
  }
  try {
    const d=await api('/api/documents/'+id);
    const tokenParam = '?token=' + encodeURIComponent(token);
    let previewHtml = '';
    if (d.mime_type && d.mime_type.startsWith('image/')) {
      previewHtml = `<h4>Xem trước hình ảnh</h4><p><img class="preview" src="${d.preview_url}${tokenParam}"></p>`;
    } else if (d.mime_type === 'application/pdf') {
      previewHtml = `<h4>Xem trước PDF</h4><p><iframe class="pdf" src="${d.preview_url}${tokenParam}"></iframe></p>`;
    }
    
    const detailEl = field('detail');
    if (!detailEl) {
      return alert('Không tìm thấy vùng hiển thị chi tiết (element #detail)!');
    }
    
    const isAuto = (d.metadata || []).some(m => m.meta_key === 'autoClassified' && m.meta_value === 'true');
    const aiSummaryMeta = (d.metadata || []).find(m => m.meta_key === 'ai_summary');
    const aiConfidenceMeta = (d.metadata || []).find(m => m.meta_key === 'aiConfidence');
    const hasText = d.extracted_text && d.extracted_text.trim();
    detailEl.innerHTML=`<div class="card">
      <h3>${esc(d.title||d.original_name)}</h3>
      <p>
        <span class="pill">${esc(docTypeLabels[d.doc_type] || d.doc_type)}</span>
        ${aiConfidenceMeta ? `<span class="pill success" title="AI confidence">AI: ${(Number(aiConfidenceMeta.meta_value)*100).toFixed(0)}%</span>` : ''}
        <span class="pill">${esc(ocrStatusLabels[d.ocr_status] || d.ocr_status)}</span>
        <a href="${d.download_url}${tokenParam}" target="_blank">Tải xuống</a>
      </p>
      ${previewHtml}
      ${d.notes ? `<p style="margin-top: 15px; background: #fffcf5; padding: 10px; border-left: 3px solid var(--accent); border-radius: 4px;"><b>Ghi chú:</b> ${esc(d.notes)}</p>` : ''}
      ${aiSummaryMeta ? `<div class="ai-summary-box"><b>AI Tóm tắt:</b> ${esc(aiSummaryMeta.meta_value)}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${has('documents.update') && hasText ? `<button class="ghost" onclick="aiSummarize(${d.id})">AI Tóm tắt</button>` : ''}
        ${has('documents.update') && hasText ? `<button class="ghost" onclick="aiClassify(${d.id})">AI Phân loại lại</button>` : ''}
      </div>
      <h4>Nội dung văn bản trích xuất (OCR)</h4>
      <pre>${esc((d.extracted_text||d.processing_error||'Chưa có nội dung trích xuất.').slice(0,3000))}</pre>
    </div>`;
    detailEl.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    alert('Lỗi hiển thị chi tiết tài liệu: ' + e.message);
  } finally {
    if (btn) {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  }
}
async function reprocessDoc(id, btn){
  const oldText = btn ? btn.textContent : '';
  if (btn) {
    btn.textContent = 'Đang OCR...';
    btn.disabled = true;
  }
  try {
    await api('/api/documents/'+id+'/reprocess',{method:'POST'});
    alert('Kích hoạt OCR lại thành công!');
    documents();
  } catch (e) {
    alert('Lỗi khi OCR lại: ' + e.message);
  } finally {
    if (btn) {
      btn.textContent = oldText;
      btn.disabled = false;
    }
  }
}
async function delDoc(id, btn){
  if(confirm('Xóa tài liệu này?')){
    const oldText = btn ? btn.textContent : '';
    if (btn) {
      btn.textContent = 'Đang xóa...';
      btn.disabled = true;
    }
    try {
      await api('/api/documents/'+id,{method:'DELETE'});
      documents();
    } catch (e) {
      alert('Lỗi khi xóa tài liệu: ' + e.message);
    } finally {
      if (btn) {
        btn.textContent = oldText;
        btn.disabled = false;
      }
    }
  }
}
async function search(){ shell(`<div class="card"><h3>Tìm kiếm dữ liệu</h3><div class="row"><input id="q" placeholder="Tìm theo tên sách, tác giả, ISBN hoặc nội dung tài liệu..." style="flex:1" onkeyup="if(event.key==='Enter') doSearch()"><button class="primary" onclick="doSearch()">Tìm kiếm</button></div></div><div id="results"></div>`); }
async function doSearch(){ try { const entityLabels = { book: 'Sách', document: 'Tài liệu' }; const rows=await api('/api/search?q='+encodeURIComponent(field('q').value)); field('results').innerHTML=`<div class="card">${rows.length?rows.map(r=>`<p><span class="pill">${esc(entityLabels[r.entity_type]||r.entity_type)} #${r.entity_id}</span> <b>${esc(r.title)}</b><br>${r.snippet||''}</p>`).join(''):empty('Không tìm thấy dữ liệu phù hợp.')}</div>`; } catch(e) { alert('Lỗi tìm kiếm: ' + e.message); } }
function downloadReport(type){
  const formatEl = document.querySelector('input[name="export_format"]:checked');
  const format = formatEl ? formatEl.value : 'csv';
  window.open('/api/reports/export/'+type+'?token='+encodeURIComponent(token)+'&format='+format,'_blank');
}
async function reports(){
  const financial=has('reports.view_financial');
  shell(`<div class="card">
    <h3>Xuất báo cáo dữ liệu</h3>
    <p class="muted">Chọn định dạng file xuất bản và loại báo cáo bạn muốn tải về.</p>
    
    <div class="format-select-container">
      <span class="format-label">Định dạng xuất:</span>
      <div class="format-options">
        <label class="format-option">
          <input type="radio" name="export_format" value="csv" checked>
          <span class="format-custom-radio">CSV (Dấu phẩy)</span>
        </label>
        <label class="format-option">
          <input type="radio" name="export_format" value="excel">
          <span class="format-custom-radio">Excel (.xlsx)</span>
        </label>
      </div>
    </div>
    
    <div class="report-actions" style="margin-top: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
      ${has('books.view')?'<button class="ghost primary" onclick="downloadReport(\'books\')">Báo cáo sách</button>':''}
      ${has('orders.view')?'<button class="ghost primary" onclick="downloadReport(\'orders\')">Báo cáo đơn hàng</button>':''}
      ${has('inventory.view')?'<button class="ghost primary" onclick="downloadReport(\'inventory\')">Báo cáo tồn kho</button>':''}
      ${has('inventory.view')?'<button class="ghost primary" onclick="downloadReport(\'slips\')">Báo cáo phiếu kho</button>':''}
      ${has('documents.view')?'<button class="ghost primary" onclick="downloadReport(\'documents\')">Báo cáo tài liệu</button>':''}
    </div>
    
    <div style="margin-top: 20px;">
      ${financial?'<span class="pill success">Bạn có quyền xem báo cáo tài chính chi tiết.</span>':'<span class="pill warning">Bạn chỉ có quyền xem báo cáo cơ bản, không hiển thị báo cáo tài chính chi tiết.</span>'}
    </div>
  </div>
  <div id="unstructured-analytics">
    <div class="card">
      <p class="muted">Đang tải thống kê dữ liệu phi cấu trúc...</p>
    </div>
  </div>`);

  try {
    const data = await api('/api/dashboard');
    const stats = data.unstructuredStats;
    if (stats) {
      const sizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
      const mimeLabels = {
        'application/pdf': 'Tệp PDF',
        'image/png': 'Hình ảnh PNG',
        'image/jpeg': 'Hình ảnh JPEG',
        'image/webp': 'Hình ảnh WebP',
        'image/gif': 'Hình ảnh GIF',
        'image/jfif': 'Hình ảnh JFIF',
        'text/plain': 'Văn bản thô TXT',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Tệp Word (.docx)'
      };
      
      const mimeDistributionHtml = stats.mimeDistribution.map(m => {
        const percent = stats.totalDocs ? ((m.count / stats.totalDocs) * 100).toFixed(0) : 0;
        return `<p style="margin: 8px 0; font-size: 13px;">
          <strong>${esc(mimeLabels[m.mime_type] || m.mime_type)}</strong>: ${m.count} tệp (${percent}%)
          <span style="display:block; background:#ead7ad; height:6px; border-radius:3px; margin-top:4px; width: ${percent}%"></span>
        </p>`;
      }).join('') || '<p class="muted">Chưa có phân phối định dạng.</p>';

      const ocrDistributionHtml = stats.ocrStatusDistribution.map(o => {
        const label = ocrStatusLabels[o.ocr_status] || o.ocr_status;
        const color = o.ocr_status === 'done' ? 'success' : o.ocr_status === 'failed' ? 'danger' : 'muted';
        return `<span class="pill ${color}" style="margin: 4px 4px 4px 0;">${esc(label)}: ${o.count}</span>`;
      }).join('');

      const analyticsContainer = field('unstructured-analytics');
      if (analyticsContainer) {
        analyticsContainer.innerHTML = `<div class="card">
          <h3>📊 Báo cáo phân tích dữ liệu phi cấu trúc</h3>
          <p class="muted">Thống kê lưu trữ vật lý, phân phối định dạng file và hiệu suất OCR hệ thống.</p>
          
          <div class="grid" style="margin-top: 15px;">
            <div class="stat">
              <span>Tổng số tài liệu</span>
              <b>${stats.totalDocs}</b>
            </div>
            <div class="stat">
              <span>Dung lượng trên đĩa</span>
              <b>${sizeMB} MB</b>
            </div>
          </div>
          
          <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; flex-wrap: wrap;">
            <div>
              <h4 style="margin: 0 0 10px 0; color: #123b35;">📂 Phân phối định dạng file</h4>
              ${mimeDistributionHtml}
            </div>
            <div>
              <h4 style="margin: 0 0 10px 0; color: #123b35;">🤖 Trạng thái xử lý OCR</h4>
              <p>${ocrDistributionHtml}</p>
              <p style="margin-top: 15px; font-size: 12px;" class="muted">
                * Trạng thái <strong>Đã xử lý</strong> cho biết file đã chạy qua mô hình OCR Tesseract hoặc Parser bóc tách chữ thành công và được SQLite FTS5 đánh chỉ mục.
              </p>
            </div>
          </div>
        </div>`;
      }
    }
  } catch (e) {
    const analyticsContainer = field('unstructured-analytics');
    if (analyticsContainer) {
      analyticsContainer.innerHTML = `<div class="card error">Lỗi tải báo cáo thống kê: ${esc(e.message)}</div>`;
    }
  }
}
async function users(){ const usersAllowed=has('users.view'); const rolesAllowed=has('roles.manage'); let html=''; if(usersAllowed){ const rows=await api('/api/users'); html+=`<div class="card"><h3>Nhân viên</h3>${table(rows.map(r=>({'Mã':r.id,'Họ tên':esc(r.full_name),'Email':esc(r.email),'Vai trò':esc(roleLabels[r.role]||r.role),'Hoạt động':r.is_active?'Có':'Không'})))}</div>`; } if(rolesAllowed){ const [roles,permissions]=await Promise.all([api('/api/roles'),api('/api/permissions')]); html+=`<div class="card"><h3>Vai trò & quyền</h3><p class="muted">Tick/bỏ tick quyền theo từng vai trò, sau đó bấm lưu.</p>${roles.map(r=>rolePermissionEditor(r,permissions)).join('')}</div>`; } shell(html||empty('Bạn không có quyền quản lý nhân viên/phân quyền.')); }
function permissionLabel(code){ const map={view:'Xem',view_all:'Xem tất cả',create:'Tạo mới',update:'Cập nhật',delete:'Xóa',cancel:'Hủy',import:'Nhập kho',export:'Xuất kho',adjust:'Điều chỉnh',upload:'Tải lên',use:'Sử dụng',view_basic:'Báo cáo cơ bản',view_financial:'Báo cáo tài chính',manage:'Quản lý'}; return map[code.split('.').slice(1).join('.')]||code; }
function rolePermissionEditor(role,permissions){ const owned=new Set(role.permissions.map(p=>p.id)); const groups=permissions.reduce((a,p)=>{ const g=p.code.split('.')[0]; (a[g] ||= []).push(p); return a; },{}); return `<div class="role-editor" data-role-id="${role.id}"><h4>${esc(roleLabels[role.name]||role.name)} <span class="pill">${role.permissions.length} quyền</span></h4>${Object.entries(groups).map(([g,ps])=>`<div class="perm-group"><b>${esc(g)}</b><div class="checks">${ps.map(p=>`<label><input type="checkbox" value="${p.id}" ${owned.has(p.id)?'checked':''}> ${esc(permissionLabel(p.code))}<small>${esc(p.code)}</small></label>`).join('')}</div></div>`).join('')}<button class="primary" onclick="saveRolePermissions(${role.id})">Lưu quyền</button></div>`; }
async function saveRolePermissions(roleId){ try { const root=document.querySelector(`.role-editor[data-role-id="${roleId}"]`); const permission_ids=[...root.querySelectorAll('input[type=checkbox]:checked')].map(x=>Number(x.value)); await api('/api/roles/'+roleId+'/permissions',{method:'PUT',body:{permission_ids}}); users(); } catch (e) { alert('Lỗi khi lưu quyền: ' + e.message); } }
async function auditLogs(){
  if (activeAuditSubTab === 'files') return showLogFiles();
  return showAuditList();
}
async function showAuditList(){
  const rows = await api('/api/audit-logs');
  shell(`${auditSubTabsHtml()}<div class="card"><h3>Nhật ký kiểm tra</h3>${table(rows.map(r=>({'Thời gian':r.created_at,'Nhân viên':esc(r.user_name),'Hành động':esc(r.action),'Đối tượng':esc(r.entity_type)+' #'+r.entity_id})))}</div>`);
}
async function showLogFiles(){
  const files = await api('/api/logs');
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fileRows = files.length ? `<div class="tablewrap"><table><thead><tr><th>Tệp nhật ký</th><th>Số dòng</th><th>Dung lượng</th><th>Thao tác</th></tr></thead><tbody>${files.map(f => `<tr>
    <td><a href="#" onclick="viewLogFile('${f.date}');return false">${esc(f.filename)}</a></td>
    <td>${f.lines}</td>
    <td>${f.sizeKB} KB</td>
    <td class="actions"><button class="ghost" onclick="viewLogFile('${f.date}')">Xem</button> <button class="ghost" onclick="downloadLogFile('${f.date}')">Tải về</button></td>
  </tr>`).join('')}</tbody></table></div>` : empty('Chưa có tệp nhật ký.');
  shell(`${auditSubTabsHtml()}
    <div class="card">
      <h3>Xuất nhật ký theo khoảng thời gian</h3>
      <div class="table-controls">
        <div class="control-group"><label>Từ ngày:</label><input type="date" id="log_from" value="${monthAgo}"></div>
        <div class="control-group"><label>Đến ngày:</label><input type="date" id="log_to" value="${today}"></div>
        <div class="control-group"><label>Định dạng:</label>
          <select id="log_format">
            <option value="log">Tệp Log (.log)</option>
            <option value="csv">CSV (.csv)</option>
            <option value="xlsx">Excel (.xlsx)</option>
          </select>
        </div>
        <button class="primary" onclick="exportLogRange()">Xuất file</button>
      </div>
    </div>
    <div class="card">
      <h3>Danh sách tệp nhật ký hệ thống</h3>
      <p class="muted">Tệp nhật ký tự động nhóm theo ngày.</p>
      ${fileRows}
    </div>
    <div id="log-viewer"></div>`);
}
async function exportLogRange(){
  const from = field('log_from').value;
  const to = field('log_to').value;
  const format = field('log_format').value;
  try {
    const r = await fetch(apiBase + '/api/logs/range/export?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&format=' + encodeURIComponent(format), { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Xuất file thất bại'); }
    const blob = await r.blob();
    const ext = format === 'xlsx' ? 'xlsx' : format === 'csv' ? 'csv' : 'log';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `activity-log-${from}-to-${to}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert(e.message); }
}
async function viewLogFile(date){
  try {
    const data = await api('/api/logs/' + date);
    const el = field('log-viewer');
    if (el) {
      el.innerHTML = `<div class="card"><h3>Nội dung: ${esc(date)}.log</h3><p class="muted">${data.total} dòng</p><pre>${esc((data.lines || []).join('\n'))}</pre></div>`;
      el.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (e) { alert('Lỗi đọc nhật ký: ' + e.message); }
}
async function downloadLogFile(date){
  try {
    const r = await fetch(apiBase + '/api/logs/' + date + '/download', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Tải file thất bại');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `activity-${date}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert(e.message); }
}

async function aiSummarize(id) {
  try {
    const result = await api('/api/ai/summarize/' + id, { method: 'POST' });
    alert('AI đã tóm tắt: ' + result.summary);
    const detailEl = field('detail');
    if (detailEl) {
      const current = detailEl.innerHTML;
      detailEl.innerHTML = `<div class="ai-summary-box"><b>AI Tóm tắt:</b> ${esc(result.summary)}</div>` + current;
    }
  } catch (e) {
    alert('Lỗi AI tóm tắt: ' + e.message);
  }
}

async function aiClassify(id) {
  try {
    const result = await api('/api/ai/classify/' + id, { method: 'POST' });
    alert(`AI đã phân loại: ${result.doc_type} (độ tin cậy: ${(result.confidence * 100).toFixed(0)}%, trước đó: ${result.previous})`);
    const detailEl = field('detail');
    if (detailEl) docDetail(id);
  } catch (e) {
    alert('Lỗi AI phân loại: ' + e.message);
  }
}

async function aiAssistant() {
  shell(`<div class="chat-container">
    <div class="chat-main">
      <div class="chat-messages" id="chatMessages">
        ${chatHistory.length ? '' : `<div class="chat-empty">Quản lý sách bằng giọng nói tự nhiên.<br><small>VD: "Thêm sách Nhà giả kim" | "Ngưng bán Mắt biếc" | "Tăng giá Đắc nhân tâm lên 150k" | "Nhập thêm 10 cuốn Sapiens"</small></div>`}
      </div>
      <div class="chat-input-row">
        <input id="chatInput" placeholder="Nhập yêu cầu..." onkeyup="if(event.key==='Enter') sendChat()">
        <button class="primary" onclick="sendChat()">Gửi</button>
      </div>
    </div>
  </div>`);
  renderChatHistory();
}

function renderChatHistory() {
  const el = field('chatMessages');
  if (!el) return;
  if (!chatHistory.length) return;
  el.innerHTML = chatHistory.map(function(m) {
    var extra = '';
    if (m.action === 'search_result' && m.book_info) {
      extra = '<div class="chat-action-card"><b>📖 ' + esc(m.book_info.title) + '</b><br>✍️ ' + esc(m.book_info.author || '?') + ' | 📚 ' + esc(m.book_info.category || '?') + '<br>💰 Giá tham khảo: ' + (m.book_info.estimated_price ? money(m.book_info.estimated_price) : 'Chưa có') + '</div>';
    }
    if (m.action === 'confirm_create' && m.book_info) {
      extra = '<div class="chat-action-card confirm"><b>📖 ' + esc(m.book_info.title) + '</b><br>✍️ ' + esc(m.book_info.author || '?') + '<br>💰 Nhập: ' + money(m.book_info.import_price) + ' | Bán: ' + money(m.book_info.sale_price) + '<br><button class="primary" onclick="confirmBookAction()">✅ Xác nhận thêm</button> <button class="ghost" onclick="cancelBookAction()">Hủy</button></div>';
    }
    if (m.action === 'create_success' && m.book) {
      extra = '<div class="chat-action-card success">✅ Đã thêm! Mã: <b>' + esc(m.book.code) + '</b> — <a href="#" onclick="go(\'books\')">Xem tab Sách</a></div>';
    }
    if (m.action === 'confirm_toggle') {
      extra = '<div class="chat-action-card confirm"><button class="primary" onclick="confirmBookAction()">✅ Xác nhận</button> <button class="ghost" onclick="cancelBookAction()">Hủy</button></div>';
    }
    if (m.action === 'confirm_price') {
      extra = '<div class="chat-action-card confirm"><button class="primary" onclick="confirmBookAction()">✅ Xác nhận đổi giá</button> <button class="ghost" onclick="cancelBookAction()">Hủy</button></div>';
    }
    if (m.action === 'confirm_stock') {
      extra = '<div class="chat-action-card confirm"><button class="primary" onclick="confirmBookAction()">✅ Xác nhận điều chỉnh tồn</button> <button class="ghost" onclick="cancelBookAction()">Hủy</button></div>';
    }
    if (m.action === 'confirm_update') {
      extra = '<div class="chat-action-card confirm"><button class="primary" onclick="confirmBookAction()">✅ Xác nhận cập nhật</button> <button class="ghost" onclick="cancelBookAction()">Hủy</button></div>';
    }
    if (m.action === 'toggle_success' || m.action === 'price_success' || m.action === 'stock_success' || m.action === 'update_success' || m.action === 'cancelled') {
      extra = '';
    }
    return '<div class="chat-msg ' + m.role + '"><div class="chat-bubble"><b>' + (m.role === 'user' ? 'Bạn' : 'AI') + ':</b> ' + esc(m.content) + '</div>' + (m.sources ? '<div class="chat-sources"><small>Nguồn: ' + m.sources.map(function(s) { return '<span class="pill">#' + s.document_id + ' ' + esc(s.title) + '</span>'; }).join(' ') + '</small></div>' : '') + extra + '</div>';
  }).join('') + '<div id="chatLoading"></div>';
  el.scrollTop = el.scrollHeight;
}

async function sendChat() {
  const input = field('chatInput');
  const question = (input?.value || '').trim();
  if (!question) return;
  input.value = '';
  chatHistory.push({ role: 'user', content: question });
  renderChatHistory();
  const loadingEl = field('chatLoading');
  if (loadingEl) loadingEl.innerHTML = '<div class="chat-msg ai"><div class="chat-bubble"><em>Đang suy nghĩ...</em></div></div>';

  try {
    const result = await api('/api/ai/chat', {
      method: 'POST',
      body: { question, history: chatHistory.map(m => ({ role: m.role, content: m.content })) }
    });
    chatHistory.push({ role: 'assistant', content: result.answer, sources: result.sources, action: result.action, book_info: result.book_info, book: result.book, book_id: result.book_id });
  } catch (e) {
    chatHistory.push({ role: 'assistant', content: 'Lỗi: ' + e.message, sources: [] });
  }
  if (loadingEl) loadingEl.innerHTML = '';
  renderChatHistory();
}

async function confirmBookAction() {
  await sendChatMessage('OK');
}
async function cancelBookAction() {
  await sendChatMessage('Hủy');
}
async function sendChatMessage(msg) {
  chatHistory.push({ role: 'user', content: msg });
  renderChatHistory();
  const loadingEl = field('chatLoading');
  if (loadingEl) loadingEl.innerHTML = '<div class="chat-msg ai"><div class="chat-bubble"><em>Đang xử lý...</em></div></div>';
  try {
    const result = await api('/api/ai/chat', {
      method: 'POST',
      body: { question: msg, history: chatHistory.slice(0, -1).map(m => ({ role: m.role, content: m.content })) }
    });
    chatHistory.push({ role: 'assistant', content: result.answer, sources: result.sources, action: result.action, book_info: result.book_info, book: result.book, book_id: result.book_id });
  } catch (e) {
    chatHistory.push({ role: 'assistant', content: 'Lỗi: ' + e.message, sources: [] });
  }
  if (loadingEl) loadingEl.innerHTML = '';
  renderChatHistory();
}

async function feedbacks() {
  if (!allBooks.length) allBooks = await api('/api/books').catch(() => []);
  const bookMap = {};
  allBooks.forEach(b => { bookMap[b.id] = b.title; });
  const data = await api('/api/feedbacks?limit=100');
  const rows = data.list || [];
  const statusLabels = { new: 'Mới', reviewed: 'Đã duyệt', resolved: 'Bị từ chối' };
  const sentimentLabels = { positive: 'Tích cực', negative: 'Tiêu cực', neutral: 'Trung lập' };
  const sentimentClasses = { positive: 'success', negative: 'danger', neutral: 'warning' };
  const statusClasses = { new: 'warning', reviewed: 'success', resolved: 'danger' };
  const editable = has('books.update');
  const mappedRows = rows.map(r => {
    const bookTitle = bookMap[r.bookId] || ('Sách #' + r.bookId);
    const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
    const row = {
      'Sách': '<b>' + esc(bookTitle) + '</b>',
      'Khách hàng': esc(r.customerName) + '<br><small class="muted">' + esc(r.email || '') + '</small>',
      'Đánh giá': '<span class="star-rating">' + stars + '</span>',
      'Nhận xét': '<div class="feedback-comment">' + esc(r.comment) + '</div>',
      'Tags': (r.tags || []).map(t => '<span class="pill tag-pill">' + esc(t) + '</span>').join(' ') || '<span class="muted">-</span>',
      'Cảm xúc': '<span class="pill ' + (sentimentClasses[r.sentiment] || 'warning') + '">' + esc(sentimentLabels[r.sentiment] || r.sentiment || 'Trung lập') + '</span>',
      'Trạng thái': '<span class="pill ' + (statusClasses[r.status] || 'warning') + '">' + esc(statusLabels[r.status] || r.status || 'Mới') + '</span>'
    };
    if (editable) {
      row['Ảnh'] = (r.media && r.media.length) ? '<button class="ghost" onclick="showFeedbackMedia(' + r.id + ')">Ảnh (' + r.media.length + ')</button>' : '<span class="muted">-</span>';
      row['Nổi bật'] = r.isFeatured
        ? '<button class="ghost warning" onclick="toggleFeedbackFeatured(' + r.id + ', false)">Bỏ nổi bật</button>'
        : '<button class="ghost" onclick="toggleFeedbackFeatured(' + r.id + ', true)">Nổi bật</button>';
      if (r.status === 'new') {
        row['Duyệt'] = '<button class="ghost success" onclick="setFeedbackStatus(' + r.id + ', \'reviewed\')">Duyệt</button>';
        row['Từ chối'] = '<button class="ghost danger" onclick="setFeedbackStatus(' + r.id + ', \'resolved\')">Từ chối</button>';
      } else if (r.status === 'reviewed') {
        row['Duyệt'] = '<span class="pill success">Đã duyệt</span>';
        row['Từ chối'] = '<button class="ghost danger" onclick="setFeedbackStatus(' + r.id + ', \'resolved\')">Từ chối</button>';
      } else {
        row['Duyệt'] = '<button class="ghost success" onclick="setFeedbackStatus(' + r.id + ', \'reviewed\')">Duyệt lại</button>';
        row['Từ chối'] = '<span class="pill danger">Đã từ chối</span>';
      }
      row['Xóa'] = '<button class="ghost danger" onclick="deleteFeedback(' + r.id + ')">Xóa</button>';
    } else {
      row['Ảnh'] = (r.media && r.media.length) ? '<button class="ghost" onclick="showFeedbackMedia(' + r.id + ')">Ảnh (' + r.media.length + ')</button>' : '<span class="muted">-</span>';
      row['Nổi bật'] = r.isFeatured ? '<span class="pill success">Có</span>' : '<span class="muted">-</span>';
    }
    return row;
  });
  shell('<div class="card feedback-card"><h3>Quản lý nhận xét & Đánh giá sách</h3><p class="muted">Xem các đánh giá từ khách hàng, cảm xúc và tags. Đánh giá được gửi từ cổng khách tại <a href="/customer.html" target="_blank">customer.html</a>.</p>' + table(mappedRows) + '</div><div id="feedbackDetail"></div>');
}
async function showFeedbackMedia(id) {
  try {
    const data = await api('/api/feedbacks?limit=100');
    const f = (data.list || []).find(x => String(x.id) === String(id));
    const detail = field('feedbackDetail');
    if (!f || !detail) return;
    const imgs = (f.media || []).map(m => '<img class="preview feedback-thumb" src="' + m.url + '" alt="' + esc(m.fileName || 'Ảnh') + '">').join('');
    detail.innerHTML = '<div class="card"><h3>Ảnh phản hồi #' + esc(id) + '</h3>' + (imgs || '<p class="muted">Không có ảnh.</p>') + '</div>';
    detail.scrollIntoView({ behavior: 'smooth' });
  } catch (e) { alert('Lỗi tải ảnh phản hồi: ' + e.message); }
}
async function toggleFeedbackFeatured(id, featured) {
  try {
    await api('/api/feedbacks/' + id + '/featured', { method: 'PUT', body: { isFeatured: featured } });
    feedbacks();
  } catch (e) { alert('Lỗi cập nhật nổi bật: ' + e.message); }
}
async function setFeedbackStatus(id, status) {
  try {
    await api('/api/feedbacks/' + id + '/status', { method: 'PUT', body: { status } });
    feedbacks();
  } catch (e) { alert('Lỗi cập nhật trạng thái: ' + e.message); }
}
async function deleteFeedback(id) {
  if (!confirm('Xóa phản hồi này?')) return;
  try {
    await api('/api/feedbacks/' + id, { method: 'DELETE' });
    feedbacks();
  } catch (e) { alert('Lỗi xóa phản hồi: ' + e.message); }
}

render();
