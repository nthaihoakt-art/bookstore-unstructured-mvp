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

let allBooks = [];
let bookCategories = [];
let bookFilters = { category: '', sort: 'default' };

let allOrders = [];
let orderFilters = { status: '', sort: 'date-desc' };

let allCustomers = [];
let customerFilters = { type: '', sort: 'name-asc' };

const roleLabels = { admin:'Quản trị viên', manager:'Quản lý nhà sách', sales:'Nhân viên bán hàng', warehouse:'Nhân viên kho', accountant:'Kế toán', document_staff:'Nhân viên tài liệu' };
const labels = { dashboard:'Tổng quan', books:'Sách', customers:'Khách hàng', orders:'Đơn hàng', inventory:'Kho sách', suppliers:'Nhà cung cấp', documents:'Tài liệu', search:'Tìm kiếm', reports:'Báo cáo', users:'Nhân viên & phân quyền', audit:'Nhật ký hoạt động', forbidden:'Không có quyền' };
const orderStatusLabels = { new: 'Mới', paid: 'Đã thanh toán', shipping: 'Đang giao hàng', completed: 'Hoàn thành', cancelled: 'Đã hủy' };
const docTypeLabels = { invoice: 'Hóa đơn', contract: 'Hợp đồng', cover: 'Ảnh bìa', inventory_note: 'Ghi chú kho', customer_feedback: 'Phản hồi khách', book_description: 'Mô tả sách', internal: 'Nội bộ' };
const ocrStatusLabels = { done: 'Đã xử lý', failed: 'Thất bại', processing: 'Đang xử lý', not_required: 'Không yêu cầu' };
const customerTypeLabels = { retail: 'Khách lẻ', loyal: 'Khách thân thiết', wholesale: 'Khách sỉ' };
const routePerms = {
  dashboard:['reports.view_basic'], books:['books.view'], customers:['customers.view'], orders:['orders.view'], inventory:['inventory.view'], suppliers:['suppliers.view'], documents:['documents.view'], search:['search.use'], reports:['reports.view_basic','reports.view_financial'], users:['users.view','roles.manage'], audit:['audit_logs.view']
};
const menu = [
  ['dashboard','Tổng quan'], ['books','Sách'], ['customers','Khách hàng'], ['orders','Đơn hàng'], ['inventory','Kho sách'], ['suppliers','Nhà cung cấp'], ['documents','Tài liệu'], ['search','Tìm kiếm'], ['reports','Báo cáo'], ['users','Nhân viên & phân quyền'], ['audit','Nhật ký hoạt động']
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
async function api(path,opt={}){ opt.headers={...(opt.headers||{}),Authorization:'Bearer '+token}; if(opt.body && !(opt.body instanceof FormData)){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(opt.body); } const r=await fetch(apiBase+path,opt); const ct=r.headers.get('content-type')||''; const j=ct.includes('json')?await r.json().catch(()=>({})):{}; if(!r.ok) throw new Error(j.error || (r.status===403?'Bạn không có quyền truy cập chức năng này.':'Không thể tải dữ liệu.')); return j; }
async function login(){ try{ field('err').textContent='Đang đăng nhập...'; const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:field('email').value,password:field('password').value})}).then(async x=>{const j=await x.json(); if(!x.ok) throw new Error(j.error); return j;}); token=r.token; user=r.user; localStorage.token=token; localStorage.user=JSON.stringify(user); tab='dashboard'; localStorage.tab=tab; render(); }catch(e){ field('err').textContent=e.message || 'Đăng nhập không thành công.'; } }
function logout(){ localStorage.clear(); token=''; user=null; tab='dashboard'; render(); }
function go(t){ tab=t; localStorage.tab=t; render(); }
function roleHomeTitle(){ return {admin:'Tổng quan quản trị hệ thống',manager:'Tổng quan quản lý nhà sách',sales:'Tổng quan bán hàng',warehouse:'Tổng quan kho sách',accountant:'Tổng quan tài chính',document_staff:'Tổng quan tài liệu'}[user?.role] || 'Tổng quan'; }
function shell(content){ const nav=menu.filter(([k])=>canRoute(k)); app(`<div class="layout"><aside class="side"><div class="brand">🌿 Nhà sách Pò Books</div><div class="userbox"><b>${esc(user.fullName)}</b><br><span>${esc(roleLabels[user.role]||user.role)}</span></div><div class="nav">${nav.map(([k,v])=>`<button class="${tab===k?'active':''}" onclick="go('${k}')">${esc(k==='dashboard'?roleHomeTitle():v)}</button>`).join('')}</div></aside><main class="main"><div class="top"><div><h2>${esc(tab==='dashboard'?roleHomeTitle():(labels[tab]||'Nhà sách'))}</h2><p class="muted">Giao diện và quyền thao tác được lọc theo vai trò đăng nhập.</p></div><button class="ghost" onclick="logout()">Đăng xuất</button></div>${content}</main></div>`); }
function forbidden(){ shell(`<div class="card error"><h3>403 - Bạn không có quyền truy cập chức năng này.</h3><p>Vui lòng quay lại menu được cấp quyền hoặc liên hệ quản trị viên nếu cần thêm quyền.</p></div>`); }
function table(rows,headers={}){ if(!rows?.length) return empty(); const keys=Object.keys(rows[0]); return `<div class="tablewrap"><table><thead><tr>${keys.map(k=>`<th>${esc(headers[k]||k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${keys.map(k=>`<td>${r[k] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
async function render(){ if(!token||!user) return app(`<div class="login card"><h2>Đăng nhập hệ thống nhà sách</h2><p class="muted">Chọn tài khoản demo theo vai trò để kiểm tra RBAC.</p><div id="err" class="error" style="min-height:20px"></div><label>Email nhân viên</label><p><input id="email" value="admin@bookstore.local" style="width:100%"></p><label>Mật khẩu</label><p><input id="password" type="password" value="Admin123!" style="width:100%"></p><button class="primary" onclick="login()">Đăng nhập</button><p class="muted">Demo: admin/manager/sales/warehouse/accountant/documents @bookstore.local</p></div>`); if(!canRoute(tab)) tab=firstAllowed(); try{ if(!canRoute(tab)) return forbidden(); if(tab==='dashboard') return dashboard(); if(tab==='books') return books(); if(tab==='customers') return customers(); if(tab==='orders') return orders(); if(tab==='inventory') return inventory(); if(tab==='suppliers') return suppliers(); if(tab==='documents') return documents(); if(tab==='search') return search(); if(tab==='reports') return reports(); if(tab==='users') return users(); if(tab==='audit') return auditLogs(); }catch(e){ if(String(e.message).includes('quyền')) return forbidden(); shell(`<div class="error">${esc(e.message)}</div>`); } }
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
    ${table(filtered.map(r=>({'Mã':esc(r.code),'Tên sách':`<a href="#" onclick="bookDetail(${r.id})">${esc(r.title)}</a>`,'Tác giả':esc(r.author),'Thể loại':esc(r.category),'Giá bán':money(r.sale_price),'Tồn kho':r.stock_quantity,'Thao tác':`${has('books.update')?`<button class="ghost" onclick="editBook(${r.id})">Sửa</button>`:''} ${has('books.delete')?`<button class="ghost danger" onclick="delBook(${r.id})">Xóa</button>`:''}`})))}
  </div>`;
  shell(`${form}${listCard}<div id="detail"></div>`);
}
async function editBook(id){ const b=await api('/api/books/'+id); ['id','code','title','author','category','publisher','isbn','sale_price','stock_quantity','description'].forEach(k=>{const el=field('b_'+k); if(el) { if (k === 'code') el.value = (b[k]||'').replace(/^BOOK-/, ''); else el.value = b[k]||''; }}); }
async function saveBook(){ try { const id=field('b_id').value; const codeVal=field('b_code').value.trim(); if(!/^\d+$/.test(codeVal)){ return alert('Mã sách chỉ được phép nhập số (tiền tố BOOK- sẽ tự động được thêm)'); } const body={code:'BOOK-'+codeVal,title:field('b_title').value,author:field('b_author').value,category:field('b_category').value,publisher:field('b_publisher').value,isbn:field('b_isbn').value,sale_price:Number(field('b_sale_price').value||0),stock_quantity:Number(field('b_stock_quantity').value||0),description:field('b_description').value,tags:[]}; if (body.sale_price < 0 || body.stock_quantity < 0) { return alert('Giá bán và số lượng tồn kho không được là số âm!'); } await api(id?'/api/books/'+id:'/api/books',{method:id?'PUT':'POST',body}); books(); } catch (e) { alert('Lỗi khi lưu sách: ' + e.message); } }
async function delBook(id){ if(confirm('Xóa sách này?')){ try { await api('/api/books/'+id,{method:'DELETE'}); books(); } catch (e) { alert('Lỗi khi xóa sách: ' + e.message); } } }
async function bookDetail(id){ try { const b=await api('/api/books/'+id); const docs = (b.documents || []).map(d => ({ 'Mã': d.id, 'Tên tài liệu': `<a href="#" onclick="docDetail(${d.id})">${esc(d.original_name)}</a>`, 'Loại': docTypeLabels[d.doc_type] || d.doc_type, 'Tiêu đề': esc(d.title || ''), 'Ngày tạo': d.created_at })); field('detail').innerHTML=`<div class="card"><h3>${esc(b.title)}</h3><p><b>Tác giả:</b> ${esc(b.author)} | <b>NXB:</b> ${esc(b.publisher)} | <b>Tồn:</b> ${b.stock_quantity}</p><p>${esc(b.description)}</p><h4>Tài liệu liên quan</h4>${table(docs)}</div>`; } catch (e) { alert('Lỗi hiển thị chi tiết sách: ' + e.message); } }
async function customers(){
  allCustomers = await api('/api/customers');
  renderCustomersList();
}
function renderCustomersList() {
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
    ${table(filtered.map(r=>({'Mã':r.id,'Họ tên':`<a href="#" onclick="customerDetail(${r.id})">${esc(r.full_name)}</a>`,'Điện thoại':esc(r.phone),'Email':esc(r.email),'Nhóm':customerTypeLabels[r.type] || r.type,'Thao tác':`${has('customers.update')?`<button class="ghost" onclick="editCustomer(${r.id})">Sửa</button>`:''} ${has('customers.delete')?`<button class="ghost danger" onclick="delCustomer(${r.id})">Xóa</button>`:''}`})))}
  </div>`;
  shell(`${form}${listCard}<div id="detail"></div>`);
}
async function saveCustomer(){ try { const fullName = field('c_full_name').value.trim(); if (!fullName) { return alert('Họ tên khách hàng không được để trống!'); } const phone = field('c_phone').value.trim(); if (phone && !/^\d{9,11}$/.test(phone)) { return alert('Số điện thoại không hợp lệ (phải từ 9 đến 11 chữ số)!'); } const email = field('c_email').value.trim(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return alert('Email không đúng định dạng!'); } const body={full_name:fullName,phone:phone||null,email:email||null,type:field('c_type').value,notes:field('c_notes').value}; const id=field('c_id').value; await api(id?'/api/customers/'+id:'/api/customers',{method:id?'PUT':'POST',body}); customers(); } catch (e) { alert('Lỗi khi lưu khách hàng: ' + e.message); } }
async function editCustomer(id){ const c=await api('/api/customers/'+id); ['id','full_name','phone','email','type','notes'].forEach(k=>{const el=field('c_'+k); if(el) el.value=c[k]||'';}); }
async function delCustomer(id){ if(confirm('Xóa khách hàng này?')){ try { await api('/api/customers/'+id,{method:'DELETE'}); customers(); } catch (e) { alert('Lỗi khi xóa khách hàng: ' + e.message); } } }
async function customerDetail(id){ try { const c=await api('/api/customers/'+id); field('detail').innerHTML=`<div class="card"><h3>${esc(c.full_name)}</h3><p>${esc(c.phone)} | ${esc(c.email)}</p><h4>Lịch sử mua hàng</h4>${table(c.orders)}</div>`; } catch (e) { alert('Lỗi hiển thị chi tiết khách hàng: ' + e.message); } }
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
async function orderDetail(id){ try { const o=await api('/api/orders/'+id); field('detail').innerHTML=`<div class="card"><h3>${esc(o.order_code)}</h3><p>${esc(o.customer_name)} | ${orderStatusLabels[o.status] || o.status} | ${money(o.total)}</p>${table(o.items,{book_title:'Sách',quantity:'SL',unit_price:'Đơn giá',total:'Thành tiền'})}</div>`; } catch (e) { alert('Lỗi hiển thị chi tiết đơn hàng: ' + e.message); } }
async function cancelOrder(id){ if(confirm('Hủy đơn và hoàn tồn kho?')){ try { await api('/api/orders/'+id+'/cancel',{method:'POST',body:{reason:'Hủy từ giao diện'}}); orders(); } catch (e) { alert('Lỗi khi hủy đơn hàng: ' + e.message); } } }
async function inventory(){ const rows=await api('/api/inventory'); const form=has('inventory.import','inventory.export','inventory.adjust')?`<div class="card"><h3>Tạo phiếu kho</h3><div class="form"><select id="sl_type"><option value="in">Nhập kho</option><option value="out">Xuất kho</option><option value="adjust">Điều chỉnh</option></select><input id="sl_supplier_id" type="number" placeholder="ID nhà cung cấp"><textarea class="full" id="sl_note" placeholder="Ghi chú"></textarea><button class="ghost" onclick="addSlipLine()">Thêm dòng</button><button class="primary" onclick="saveSlip()">Lưu phiếu kho</button></div><div id="slipLines"></div></div>`:''; shell(`${form}<div class="card"><h3>Tồn kho</h3>${table(rows.map(r=>({'ID sách':r.book_id,'Mã':esc(r.code),'Tên sách':esc(r.title),'Tồn kho':r.stock_quantity,'Giá nhập':money(r.import_price),'Giá bán':money(r.sale_price),'Thể loại':esc(r.category)})))}</div>`); drawSlipLines(); }
function addSlipLine(){ slipLines.push({book_id:'',quantity:1,unit_cost:0}); drawSlipLines(); }
function drawSlipLines(){ const el=field('slipLines'); if(!el) return; el.innerHTML=slipLines.map((l,i)=>`<p><input type="number" placeholder="ID sách" value="${l.book_id}" onchange="slipLines[${i}].book_id=Number(this.value)"> <input type="number" value="${l.quantity}" onchange="slipLines[${i}].quantity=Number(this.value)"> <input type="number" placeholder="Giá vốn" value="${l.unit_cost}" onchange="slipLines[${i}].unit_cost=Number(this.value)"></p>`).join('') || '<p class="muted">Chưa có dòng kho.</p>'; }
async function saveSlip(){ try { if (!slipLines.length) { return alert('Phiếu kho phải có ít nhất một dòng sản phẩm!'); } for (const item of slipLines) { if (!item.book_id || item.book_id <= 0) { return alert('Mã ID sách không hợp lệ!'); } if (item.quantity === 0) { return alert('Số lượng điều chỉnh/nhập/xuất không được bằng 0!'); } if (item.unit_cost < 0) { return alert('Giá vốn nhập kho không được là số âm!'); } } await api('/api/inventory/slips',{method:'POST',body:{type:field('sl_type').value,supplier_id:Number(field('sl_supplier_id').value||0)||undefined,note:field('sl_note').value,items:slipLines}}); slipLines=[]; inventory(); } catch (e) { alert('Lỗi khi lưu phiếu kho: ' + e.message); } }
async function suppliers(){ const rows=await api('/api/suppliers'); const form=has('suppliers.create','suppliers.update')?`<div class="card"><h3>Nhà cung cấp</h3><input type="hidden" id="s_id"><div class="form"><input id="s_name" placeholder="Tên nhà cung cấp"><input id="s_contact_name" placeholder="Người liên hệ"><input id="s_phone" placeholder="Điện thoại"><input id="s_email" placeholder="Email"><input id="s_address" placeholder="Địa chỉ"><button class="primary" onclick="saveSupplier()">Lưu NCC</button></div></div>`:''; shell(`${form}<div class="card"><h3>Danh sách nhà cung cấp</h3>${table(rows.map(r=>({'Mã':r.id,'Tên':esc(r.name),'Liên hệ':esc(r.contact_name),'Điện thoại':esc(r.phone),'Email':esc(r.email),'Thao tác':`${has('suppliers.update')?`<button class="ghost" onclick="editSupplier(${r.id})">Sửa</button>`:''} ${has('suppliers.delete')?`<button class="ghost danger" onclick="delSupplier(${r.id})">Xóa</button>`:''}`})))}</div>`); }
async function saveSupplier(){ try { const name = field('s_name').value.trim(); if (!name) { return alert('Tên nhà cung cấp không được để trống!'); } const phone = field('s_phone').value.trim(); if (phone && !/^\d{9,11}$/.test(phone)) { return alert('Số điện thoại không hợp lệ (phải từ 9 đến 11 chữ số)!'); } const email = field('s_email').value.trim(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { return alert('Email không đúng định dạng!'); } const id=field('s_id').value; const body={name:name,contact_name:field('s_contact_name').value,phone:phone||null,email:email||null,address:field('s_address').value,notes:'',rating:3}; await api(id?'/api/suppliers/'+id:'/api/suppliers',{method:id?'PUT':'POST',body}); suppliers(); } catch (e) { alert('Lỗi khi lưu nhà cung cấp: ' + e.message); } }
async function editSupplier(id){ const s=await api('/api/suppliers/'+id); ['id','name','contact_name','phone','email','address'].forEach(k=>{const el=field('s_'+k); if(el) el.value=s[k]||'';}); }
async function delSupplier(id){ if(confirm('Xóa nhà cung cấp này?')){ try { await api('/api/suppliers/'+id,{method:'DELETE'}); suppliers(); } catch (e) { alert('Lỗi khi xóa nhà cung cấp: ' + e.message); } } }
async function documents(){ const rows=await api('/api/documents'); const form=has('documents.upload')?`<div class="card"><h3>Tải tài liệu lên</h3><div class="form"><input id="d_file" type="file"><select id="d_type"><option value="invoice">Hóa đơn</option><option value="contract">Hợp đồng</option><option value="cover">Ảnh bìa</option><option value="inventory_note">Ghi chú kho</option><option value="customer_feedback">Phản hồi khách</option><option value="book_description">Mô tả sách</option><option value="internal">Nội bộ</option></select><select id="d_entity"><option value="">Không liên kết</option><option value="book">Sách</option><option value="order">Đơn hàng</option><option value="supplier">Nhà cung cấp</option><option value="customer">Khách hàng</option><option value="inventory_slip">Phiếu kho</option></select><input id="d_entity_id" type="number" placeholder="ID liên kết"><input id="d_title" placeholder="Tiêu đề"><input id="d_tags" placeholder="Tag"><textarea class="full" id="d_notes" placeholder="Ghi chú"></textarea><button class="primary" onclick="uploadDoc()">Tải tài liệu lên</button></div></div>`:''; shell(`${form}<div class="card"><h3>Kho tài liệu</h3>${table(rows.map(r=>({'Mã':r.id,'Tên tài liệu':`<a href="#" onclick="docDetail(${r.id})">${esc(r.original_name)}</a>`,'Loại':docTypeLabels[r.doc_type] || r.doc_type,'Liên kết':esc((r.entity_type||'')+' '+(r.entity_id||'')),'Trạng thái':ocrStatusLabels[r.ocr_status] || r.ocr_status,'Thao tác':`<button class="ghost" onclick="docDetail(${r.id}, this)">Xem</button> ${has('documents.update')?`<button class="ghost" onclick="reprocessDoc(${r.id}, this)">OCR lại</button>`:''} ${has('documents.delete')?`<button class="ghost danger" onclick="delDoc(${r.id}, this)">Xóa</button>`:''}`})))}</div><div id="detail"></div>`); }
async function uploadDoc(){ try { const f=field('d_file').files[0]; if(!f) return alert('Vui lòng chọn file.'); const fd=new FormData(); fd.append('file',f); fd.append('doc_type',field('d_type').value); fd.append('entity_type',field('d_entity').value); fd.append('entity_id',field('d_entity_id').value); fd.append('title',field('d_title').value); fd.append('tags',field('d_tags').value); fd.append('notes',field('d_notes').value); await api('/api/documents',{method:'POST',body:fd}); documents(); } catch (e) { alert('Lỗi khi tải tài liệu: ' + e.message); } }
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
    
    detailEl.innerHTML=`<div class="card">
      <h3>${esc(d.title||d.original_name)}</h3>
      <p>
        <span class="pill">${esc(docTypeLabels[d.doc_type] || d.doc_type)}</span>
        <span class="pill">${esc(ocrStatusLabels[d.ocr_status] || d.ocr_status)}</span>
        <a href="${d.download_url}${tokenParam}" target="_blank">Tải xuống</a>
      </p>
      ${previewHtml}
      <h4>Nội dung văn bản trích xuất (OCR)</h4>
      <pre>${esc((d.extracted_text||d.processing_error||'Chưa có nội dung trích xuất.').slice(0,3000))}</pre>
    </div>`;
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
  </div>`);
}
async function users(){ const usersAllowed=has('users.view'); const rolesAllowed=has('roles.manage'); let html=''; if(usersAllowed){ const rows=await api('/api/users'); html+=`<div class="card"><h3>Nhân viên</h3>${table(rows.map(r=>({'Mã':r.id,'Họ tên':esc(r.full_name),'Email':esc(r.email),'Vai trò':esc(roleLabels[r.role]||r.role),'Hoạt động':r.is_active?'Có':'Không'})))}</div>`; } if(rolesAllowed){ const [roles,permissions]=await Promise.all([api('/api/roles'),api('/api/permissions')]); html+=`<div class="card"><h3>Vai trò & quyền</h3><p class="muted">Tick/bỏ tick quyền theo từng vai trò, sau đó bấm lưu.</p>${roles.map(r=>rolePermissionEditor(r,permissions)).join('')}</div>`; } shell(html||empty('Bạn không có quyền quản lý nhân viên/phân quyền.')); }
function permissionLabel(code){ const map={view:'Xem',view_all:'Xem tất cả',create:'Tạo mới',update:'Cập nhật',delete:'Xóa',cancel:'Hủy',import:'Nhập kho',export:'Xuất kho',adjust:'Điều chỉnh',upload:'Tải lên',use:'Sử dụng',view_basic:'Báo cáo cơ bản',view_financial:'Báo cáo tài chính',manage:'Quản lý'}; return map[code.split('.').slice(1).join('.')]||code; }
function rolePermissionEditor(role,permissions){ const owned=new Set(role.permissions.map(p=>p.id)); const groups=permissions.reduce((a,p)=>{ const g=p.code.split('.')[0]; (a[g] ||= []).push(p); return a; },{}); return `<div class="role-editor" data-role-id="${role.id}"><h4>${esc(roleLabels[role.name]||role.name)} <span class="pill">${role.permissions.length} quyền</span></h4>${Object.entries(groups).map(([g,ps])=>`<div class="perm-group"><b>${esc(g)}</b><div class="checks">${ps.map(p=>`<label><input type="checkbox" value="${p.id}" ${owned.has(p.id)?'checked':''}> ${esc(permissionLabel(p.code))}<small>${esc(p.code)}</small></label>`).join('')}</div></div>`).join('')}<button class="primary" onclick="saveRolePermissions(${role.id})">Lưu quyền</button></div>`; }
async function saveRolePermissions(roleId){ try { const root=document.querySelector(`.role-editor[data-role-id="${roleId}"]`); const permission_ids=[...root.querySelectorAll('input[type=checkbox]:checked')].map(x=>Number(x.value)); await api('/api/roles/'+roleId+'/permissions',{method:'PUT',body:{permission_ids}}); users(); } catch (e) { alert('Lỗi khi lưu quyền: ' + e.message); } }
async function auditLogs(){ const rows=await api('/api/audit-logs'); shell(`<div class="card"><h3>Nhật ký hoạt động</h3>${table(rows.map(r=>({'Thời gian':r.created_at,'Nhân viên':esc(r.user_name),'Hành động':esc(r.action),'Đối tượng':esc(r.entity_type)+' #'+r.entity_id})))}</div>`); }
render();
