var apiBase = '';
var token = localStorage.customer_token || '';
var customer = null;
try { customer = JSON.parse(localStorage.customer_user || 'null'); } catch(e) { customer = null; }
var tab = 'books';
var tabParam = new URLSearchParams(location.search).get('tab');
if (tabParam === 'books' || tabParam === 'orders' || tabParam === 'profile') tab = tabParam;
var cart = JSON.parse(localStorage.cart || '[]');
var _meCache = null;
var sessionId = localStorage.sessionId;
if (!sessionId) {
  sessionId = 'session-web-' + Math.random().toString(36).substring(2, 9);
  localStorage.sessionId = sessionId;
}

function esc(s) { return String(s||'').replace(/[&<>"']/g,function(m){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]; }); }
function money(v) { return new Intl.NumberFormat('vi-VN').format(v||0) + 'đ'; }
function el(id) { return document.getElementById(id); }
function fmtTime(d) {
  if (!d) return '';
  try {
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  } catch(e) { return String(d); }
}

async function api(path, opt) {
  opt = opt || {};
  opt.headers = { Authorization: 'Bearer ' + token, ...(opt.headers || {}) };
  if (opt.body && !(opt.body instanceof FormData)) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(opt.body); }
  var r = await fetch(apiBase + path, opt);
  var ct = r.headers.get('content-type') || '';
  var j = ct.includes('json') ? await r.json().catch(function() { return {}; }) : {};
  if (!r.ok) throw new Error(j.error || 'Lỗi kết nối');
  return j;
}

async function syncCartFromRedis() {
  try {
    var r = await fetch('/api/cart/' + sessionId);
    if (r.ok) {
      var data = await r.json();
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        cart = data.items.map(function(i) {
          return { book_id: i.bookId, title: i.title, price: i.price, quantity: i.qty };
        });
        saveCart();
      } else if (cart && cart.length > 0) {
        // Nếu Redis chưa có nhưng local đang có sách trong giỏ, đẩy toàn bộ local cart lên Redis
        for (var idx = 0; idx < cart.length; idx++) {
          var item = cart[idx];
          await fetch('/api/cart/' + sessionId + '/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bookId: item.book_id, qty: item.quantity })
          }).catch(function() {});
        }
      }
    }
  } catch(e) {}
}
syncCartFromRedis();

function updateBookGridCartBadges() {
  var grid = el('booksGrid');
  if (!grid) return;
  var cards = grid.querySelectorAll('.book-card');
  cards.forEach(function(card) {
    var btn = card.querySelector('.btn-primary');
    if (!btn) return;
    var onclickAttr = btn.getAttribute('onclick') || '';
    var match = onclickAttr.match(/addToCart\((\d+)/);
    if (match) {
      var bId = parseInt(match[1]);
      var inCart = cart.find(function(i) { return i.book_id === bId; });
      btn.innerHTML = '🛒 Cho vào giỏ' + (inCart && inCart.quantity > 0 ? ' <b>(' + inCart.quantity + ')</b>' : '');
    }
  });
}

function saveCart() {
  localStorage.cart = JSON.stringify(cart);
  renderCartBadge();
  updateBookGridCartBadges();
}

async function addToCart(bookId, title, price, maxStock) {
  var item = cart.find(function(i) { return i.book_id === bookId; });
  if (item && item.quantity >= maxStock) {
    if (window.showToast) window.showToast('Thông báo', 'Chỉ còn ' + maxStock + ' cuốn trong kho!', 'error');
    else alert('Chỉ còn ' + maxStock + ' cuốn trong kho!');
    return;
  }
  
  // Ghi trực tiếp vào Redis Cart HASH qua API
  try {
    await fetch('/api/cart/' + sessionId + '/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: bookId, qty: 1 })
    });
  } catch(e) { console.warn('Lỗi ghi Redis cart:', e); }

  if (item) {
    item.quantity++;
  } else {
    cart.push({ book_id: bookId, title: title, price: price, quantity: 1 });
  }
  saveCart();
  renderCartBadge();
  renderCartPanel();
  if (window.showToast) window.showToast('Giỏ hàng', 'Đã thêm "' + title + '" vào giỏ hàng', 'success');
}

async function removeFromCart(bookId) {
  try {
    await fetch('/api/cart/' + sessionId + '/item/' + bookId, { method: 'DELETE' });
  } catch(e) {}
  cart = cart.filter(function(i) { return i.book_id !== bookId; });
  saveCart();
  renderCartBadge();
  renderCartPanel();
}

async function changeQty(bookId, delta) {
  var item = cart.find(function(i) { return i.book_id === bookId; });
  if (!item) return;
  var newQty = item.quantity + delta;

  try {
    if (newQty <= 0) {
      await fetch('/api/cart/' + sessionId + '/item/' + bookId, { method: 'DELETE' });
    } else {
      await fetch('/api/cart/' + sessionId + '/item/' + bookId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: newQty })
      });
    }
  } catch(e) {}

  if (newQty <= 0) {
    cart = cart.filter(function(i) { return i.book_id !== bookId; });
  } else {
    item.quantity = newQty;
  }
  saveCart();
  renderCartPanel();
}

// Global window functions for cart access from HTML click handlers
window.changeQty = changeQty;
window.removeFromCart = removeFromCart;
window.addToCart = addToCart;
window.checkout = checkout;
window.confirmBookAction = function() {}; // stub
window.cancelBookAction = function() {}; // stub

function renderCartBadge() {
  var total = cart.reduce(function(s, i) { return s + i.quantity; }, 0);
  var badge = el('cartBadge');
  if (badge) badge.textContent = total > 0 ? ' (' + total + ')' : '';
}

function renderCartPanel() {
  var panel = el('cartPanel');
  if (!panel) return;
  if (!cart.length) { panel.innerHTML = '<div style="text-align:center;padding:20px 0;"><span class="muted" style="font-size:13px;">🛒 Giỏ hàng của bạn đang trống.</span></div>'; return; }
  var total = cart.reduce(function(s, i) { return s + i.price * i.quantity; }, 0);
  panel.innerHTML =
    '<table style="width:100%;table-layout:fixed;font-size:12px;margin-bottom:12px;">' +
    '<thead><tr><th style="width:36%;padding:6px 2px;">Sách</th><th style="width:28%;text-align:center;padding:6px 2px;">SL</th><th style="width:24%;text-align:right;padding:6px 2px;">Tiền</th><th style="width:12%;padding:6px 2px;"></th></tr></thead><tbody>' +
    cart.map(function(i) {
      return '<tr>' +
        '<td style="font-weight:600;color:var(--primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(i.title) + '">' + esc(i.title) + '</td>' +
        '<td style="text-align:center;white-space:nowrap;padding:4px 0;"><button class="btn-sm" style="padding:1px 5px;border-radius:4px;" onclick="changeQty(' + i.book_id + ',-1)">-</button><span style="font-weight:700;margin:0 2px;">' + i.quantity + '</span><button class="btn-sm" style="padding:1px 5px;border-radius:4px;" onclick="changeQty(' + i.book_id + ',1)">+</button></td>' +
        '<td style="font-weight:700;color:var(--danger);text-align:right;white-space:nowrap;">' + money(i.price * i.quantity) + '</td>' +
        '<td style="text-align:center;"><button class="btn-sm btn-danger" style="padding:2px 4px;border-radius:4px;font-size:11px;" onclick="removeFromCart(' + i.book_id + ')">Xoá</button></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>' +
    '<div style="margin:12px 0;display:flex;justify-content:space-between;align-items:center;">' +
      '<span class="muted" style="font-size:13px;font-weight:600;">Tổng thanh toán:</span>' +
      '<span style="font-size:18px;font-weight:800;color:var(--danger);font-family:var(--font-title);">' + money(total) + '</span>' +
    '</div>' +
    '<div style="margin-bottom:12px;">' +
      '<label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--primary);">📝 Ghi chú đơn hàng</label>' +
      '<input id="cartNotes" placeholder="VD: Giao giờ hành chính, gọi trước khi giao..." style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;outline:none;background:var(--bg);">' +
    '</div>' +
    '<button class="btn btn-accent" style="width:100%;padding:12px;border-radius:10px;margin-top:4px;" onclick="checkout()">Tiến Hành Đặt Hàng</button>';
}

async function checkout() {
  if (!token || !customer) {
    if (window.showToast) window.showToast('Yêu cầu', 'Vui lòng đăng nhập để đặt hàng!', 'error');
    go('login');
    return;
  }
  if (!cart.length) return;
  if (!confirm('Xác nhận đặt ' + cart.length + ' đầu sách, tổng tiền ' + money(cart.reduce(function(s,i){return s+i.price*i.quantity;},0)) + '?')) return;
  try {
    var userNotes = el('cartNotes') ? el('cartNotes').value.trim() : '';
    // Xóa giỏ Redis hiện tại rồi ghi lại toàn bộ từ local cart (tránh nhân đôi)
    await fetch('/api/cart/' + sessionId, { method: 'DELETE' }).catch(function() {});
    for (var idx = 0; idx < cart.length; idx++) {
      var cartItem = cart[idx];
      await fetch('/api/cart/' + sessionId + '/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: cartItem.book_id, qty: cartItem.quantity })
      }).catch(function() {});
    }
    // Checkout qua Redis Cart API (Tạo order MongoDB + Tự động xóa giỏ Redis HASH)
    var r = await api('/api/cart/' + sessionId + '/checkout', {
      method: 'POST',
      body: { customerName: customer.full_name, customerEmail: customer.email, notes: userNotes }
    });
    cart = []; saveCart();
    _meCache = null;
    if (window.showToast) window.showToast('Thành công', 'Đặt hàng thành công! Mã đơn: ' + r.orderCode, 'success');
    else alert('Đặt hàng thành công! Mã đơn: ' + r.orderCode);
    go('orders');
  } catch(e) {
    if (window.showToast) window.showToast('Lỗi', 'Đặt hàng thất bại: ' + e.message, 'error');
    else alert('Lỗi đặt hàng: ' + e.message);
  }
}

// ── Segment helpers ──
function segmentLabel(seg) {
  var map = { 'VIP':'Hội Viên VIP', 'Khách thân thiết':'Khách Hàng Thân Thiết', 'Khách vãng lai':'Khách Vãng Lai', 'Học sinh / Sinh viên':'Học Sinh - Sinh Viên' };
  return map[seg] || seg;
}
function segmentColor(seg) {
  if (seg === 'VIP') return '#D9A74A';
  if (seg === 'Khách thân thiết') return '#a5d6a7';
  if (seg === 'Khách vãng lai') return '#b0bec5';
  if (seg === 'Học sinh / Sinh viên') return '#90caf9';
  return '#ffffff';
}
function segmentEmoji(seg) {
  if (seg === 'VIP') return '👑';
  if (seg === 'Khách thân thiết') return '⭐';
  if (seg === 'Khách vãng lai') return '👤';
  if (seg === 'Học sinh / Sinh viên') return '🎓';
  return '📚';
}
function segmentBg(seg) {
  if (seg === 'VIP') return 'linear-gradient(135deg, #1A4D3B 0%, #0A3C2A 100%)';
  if (seg === 'Khách thân thiết') return 'linear-gradient(135deg, #2E6F40 0%, #1B4D24 100%)';
  if (seg === 'Khách vãng lai') return 'linear-gradient(135deg, #455A64 0%, #263238 100%)';
  if (seg === 'Học sinh / Sinh viên') return 'linear-gradient(135deg, #1565C0 0%, #0D47A1 100%)';
  return 'linear-gradient(135deg, #1A4D3B 0%, #0A3C2A 100%)';
}

// ── Default Cover Generator ──
function generateDefaultCover(title, author, category) {
  const gradients = [
    ['#0A3C2A', '#16563e'],
    ['#7A550F', '#B58B39'],
    ['#1e3a8a', '#3b82f6'],
    ['#581c87', '#a855f7'],
    ['#881337', '#f43f5e'],
    ['#075985', '#0284c7'],
    ['#854d0e', '#ca8a04'],
    ['#1f2937', '#4b5563']
  ];
  let hash = 0;
  var cleanTitle = String(title || '');
  for (let i = 0; i < cleanTitle.length; i++) {
    hash += cleanTitle.charCodeAt(i);
  }
  const grad = gradients[hash % gradients.length];
  
  return '<div class="svg-cover-fallback" style="background: linear-gradient(135deg, ' + grad[0] + ' 0%, ' + grad[1] + ' 100%)">' +
    '<div class="svg-cover-badge">' + esc(category || 'Sách') + '</div>' +
    '<div class="svg-cover-title">' + esc(cleanTitle) + '</div>' +
    '<div class="svg-cover-author">' + esc(author || 'Chưa rõ') + '</div>' +
  '</div>';
}
window.generateDefaultCover = generateDefaultCover;

// ── Feedback Media Modal ──
function feedbackMedia(urlArr, index) {
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;cursor:pointer;backdrop-filter:blur(8px);';
  
  var img = document.createElement('img');
  img.src = urlArr[index];
  img.style.cssText = 'max-width:90vw;max-height:80vh;border-radius:16px;box-shadow:0 25px 50px rgba(0,0,0,0.5);object-fit:contain;border:2px solid rgba(255,255,255,0.1);';
  
  var nav = document.createElement('div');
  nav.style.cssText = 'margin-top:16px;display:flex;gap:12px;align-items:center';
  
  if (urlArr.length > 1) {
    var prevBtn = document.createElement('button');
    prevBtn.textContent = '‹';
    prevBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:white;border:0;border-radius:50%;width:44px;height:44px;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.2s;';
    prevBtn.onmouseover = function() { this.style.background = 'rgba(255,255,255,0.3)'; };
    prevBtn.onmouseout = function() { this.style.background = 'rgba(255,255,255,0.2)'; };
    prevBtn.onclick = function(e) { e.stopPropagation(); var ni = (index - 1 + urlArr.length) % urlArr.length; document.body.removeChild(overlay); feedbackMedia(urlArr, ni); };
    
    var counter = document.createElement('span');
    counter.style.cssText = 'color:white;font-size:14px;font-family:var(--font-title);font-weight:700;';
    counter.textContent = (index + 1) + ' / ' + urlArr.length;
    
    var nextBtn = document.createElement('button');
    nextBtn.textContent = '›';
    nextBtn.style.cssText = 'background:rgba(255,255,255,0.2);color:white;border:0;border-radius:50%;width:44px;height:44px;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:0.2s;';
    nextBtn.onmouseover = function() { this.style.background = 'rgba(255,255,255,0.3)'; };
    nextBtn.onmouseout = function() { this.style.background = 'rgba(255,255,255,0.2)'; };
    nextBtn.onclick = function(e) { e.stopPropagation(); var ni = (index + 1) % urlArr.length; document.body.removeChild(overlay); feedbackMedia(urlArr, ni); };
    
    nav.appendChild(prevBtn);
    nav.appendChild(counter);
    nav.appendChild(nextBtn);
  }
  
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Đóng hình ảnh';
  closeBtn.style.cssText = 'margin-top:12px;background:rgba(255,255,255,0.15);color:white;border:1px solid rgba(255,255,255,0.3);border-radius:30px;padding:8px 24px;cursor:pointer;font-size:13px;font-family:var(--font-title);font-weight:700;transition:0.2s;';
  closeBtn.onmouseover = function() { this.style.background = 'rgba(255,255,255,0.25)'; };
  closeBtn.onmouseout = function() { this.style.background = 'rgba(255,255,255,0.15)'; };
  closeBtn.onclick = function() { document.body.removeChild(overlay); };
  
  overlay.onclick = function(e) { if (e.target === overlay) document.body.removeChild(overlay); };
  
  overlay.appendChild(img);
  overlay.appendChild(nav);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
}
window.feedbackMedia = feedbackMedia;

function showError(msg) {
  var errEl = el('err');
  if (!errEl) return;
  if (msg) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  } else {
    errEl.textContent = '';
    errEl.style.display = 'none';
  }
}

function showRegister() {
  var box = el('loginBox');
  if (!box) return;
  box.innerHTML = 
    '<h2>📚 Cổng Đăng Ký</h2>' +
    '<p class="muted" style="margin-top:2px;font-size:13px;">Tạo tài khoản khách hàng để nhận ưu đãi và tích lũy doanh số</p>' +
    '<div class="err" id="err"></div>' +
    '<label style="display:block;margin-top:16px;font-weight:600;color:var(--primary);font-size:13px;">Họ và Tên</label>' +
    '<input id="regName" placeholder="Nguyễn Văn A" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;margin-top:6px;background-color:var(--bg);">' +
    '<label style="display:block;margin-top:16px;font-weight:600;color:var(--primary);font-size:13px;">Địa chỉ Email</label>' +
    '<input id="regEmail" type="email" placeholder="example@email.com" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;margin-top:6px;background-color:var(--bg);">' +
    '<label style="display:block;margin-top:16px;font-weight:600;color:var(--primary);font-size:13px;">Số Điện Thoại</label>' +
    '<input id="regPhone" placeholder="0901234567" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;margin-top:6px;background-color:var(--bg);">' +
    '<label style="display:block;margin-top:16px;font-weight:600;color:var(--primary);font-size:13px;">Mật Khẩu (tối thiểu 6 ký tự)</label>' +
    '<input id="regPass" type="password" placeholder="••••••••" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;margin-top:6px;background-color:var(--bg);">' +
    '<button class="btn btn-primary" style="width:100%;margin-top:20px;padding:12px;" onclick="register()">Đăng ký ngay</button>' +
    '<p class="muted" style="margin-top:16px;text-align:center;font-size:13px;">Đã có tài khoản? <a href="#" style="color:var(--primary);font-weight:700;text-decoration:none;" onclick="render()">Đăng nhập ngay</a></p>';
}

function showLoginOtp() {
  var box = el('loginBox');
  if (!box) return;
  box.innerHTML = 
    '<h2>🔑 Đăng Nhập Bằng OTP</h2>' +
    '<p class="muted" style="margin-top:2px;font-size:13px;">Xác thực nhanh qua mã OTP gửi tới Email của bạn (Redis TTL 5 phút)</p>' +
    '<div class="err" id="err"></div>' +
    '<div id="otpStep1">' +
      '<label style="display:block;margin-top:16px;font-weight:600;color:var(--primary);font-size:13px;">Địa chỉ Email nhận OTP</label>' +
      '<input id="otpEmail" type="email" value="customer@test.local" placeholder="customer@test.local" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:12px;font-size:14px;margin-top:6px;background-color:var(--bg);">' +
      '<button class="btn btn-primary" style="width:100%;margin-top:20px;padding:12px;" onclick="sendOtp()">📨 Gửi Mã OTP</button>' +
    '</div>' +
    '<div id="otpStep2" style="display:none;">' +
      '<label style="display:block;margin-top:16px;font-weight:600;color:var(--primary);font-size:13px;">Mã OTP 6 chữ số (xem log server console)</label>' +
      '<input id="otpCode" placeholder="123456" maxlength="6" style="width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:12px;font-size:18px;letter-spacing:4px;text-align:center;margin-top:6px;background-color:var(--bg);">' +
      '<button class="btn btn-accent" style="width:100%;margin-top:20px;padding:12px;" onclick="verifyOtp()">✅ Xác Nhận OTP & Đăng Nhập</button>' +
      '<button class="btn btn-ghost" style="width:100%;margin-top:8px;padding:8px;" onclick="sendOtp()">🔄 Gửi lại OTP</button>' +
    '</div>' +
    '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);display:flex;justify-content:space-between;font-size:13px;">' +
      '<a href="#" style="color:var(--primary);font-weight:700;text-decoration:none;" onclick="render()">🔑 Đăng nhập mật khẩu</a>' +
      '<a href="#" style="color:var(--primary);font-weight:700;text-decoration:none;" onclick="showRegister()">📝 Đăng ký</a>' +
    '</div>';
}

async function sendOtp() {
  try {
    showError('Đang gửi OTP...');
    var email = el('otpEmail').value.trim();
    if (!email) throw new Error('Vui lòng nhập email!');
    var r = await fetch('/api/customer/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    });
    var j = await r.json();
    if (!r.ok) throw new Error(j.error);
    showError('');
    if (window.showToast) window.showToast('Mã OTP', j.message || 'Mã OTP đã được gửi thành công!', 'success');
    else alert(j.message || 'Mã OTP đã được gửi.');
    el('otpStep1').style.display = 'none';
    el('otpStep2').style.display = 'block';
  } catch(e) { showError(e.message); }
}

async function verifyOtp() {
  try {
    showError('Đang xác thực...');
    var email = el('otpEmail').value.trim();
    var otp = el('otpCode').value.trim();
    if (!otp) throw new Error('Vui lòng nhập mã OTP!');
    var r = await fetch('/api/customer/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, otp: otp })
    });
    var j = await r.json();
    if (!r.ok) throw new Error(j.error);
    token = j.token;
    customer = j.customer || { email: email, full_name: email.split('@')[0] };
    _meCache = null;
    localStorage.customer_token = token;
    localStorage.customer_user = JSON.stringify(customer);
    tab = 'books';
    showError('');
    if (window.showToast) window.showToast('Thành công', 'Đăng nhập OTP thành công!', 'success');
    render();
  } catch(e) { showError(e.message); }
}

async function login() {
  try {
    showError('Đang đăng nhập...');
    var email = el('loginEmail').value.trim();
    var password = el('loginPass').value;
    var r = await fetch('/api/customer/login', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify({ email: email, password: password }) 
    });
    var j = await r.json();
    if (!r.ok) throw new Error(j.error);
    token = j.token; 
    customer = j.customer;
    _meCache = null;
    localStorage.customer_token = token; 
    localStorage.customer_user = JSON.stringify(customer);
    tab = 'books'; 
    showError('');
    render();
  } catch(e) { 
    showError(e.message); 
  }
}

async function register() {
  try {
    showError('Đang đăng ký...');
    var name = el('regName').value.trim();
    var email = el('regEmail').value.trim();
    var phone = el('regPhone').value.trim();
    var password = el('regPass').value;
    
    if (!name || !email || !password) {
      throw new Error('Vui lòng điền đầy đủ các thông tin bắt buộc!');
    }
    if (password.length < 6) {
      throw new Error('Mật khẩu phải chứa ít nhất 6 ký tự!');
    }

    var body = { full_name: name, email: email, password: password, phone: phone };
    var r = await fetch('/api/customer/register', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
    });
    var j = await r.json();
    if (!r.ok) throw new Error(j.error);
    showError('');
    alert('Đăng ký thành công! Vui lòng đăng nhập.');
    render();
  } catch(e) { 
    showError(e.message); 
  }
}

function logout() { 
  localStorage.removeItem('customer_token'); 
  localStorage.removeItem('customer_user'); 
  token = ''; 
  customer = null; 
  tab = 'books'; 
  _meCache = null;
  render(); 
}

function go(t) { 
  tab = t; 
  var url = new URL(window.location);
  if (t === 'books' || t === 'orders' || t === 'profile') {
    url.searchParams.set('tab', t);
  } else {
    url.searchParams.delete('tab');
  }
  window.history.pushState({}, '', url);
  render(); 
}

function triggerSearch() {
  var searchInput = el('searchInput');
  var val = searchInput ? searchInput.value.trim() : '';
  var url = new URL(window.location);
  if (val) {
    url.searchParams.set('search', val);
  } else {
    url.searchParams.delete('search');
  }
  window.history.pushState({}, '', url);
  if (tab !== 'books') {
    tab = 'books';
    url.searchParams.set('tab', 'books');
    window.history.pushState({}, '', url);
    render();
  } else {
    loadBooks();
  }
}


// ── Render ──
function render() {
  var root = el('app');
  var searchVal = new URLSearchParams(location.search).get('search') || '';
  
  // Render Header wrapped in header-wrapper
  var header = '';
  if (!token || !customer) {
    header = '<div class="header-wrapper"><div class="header"><div class="logo" style="cursor:pointer" onclick="go(\'books\')">🌿 Bookstore<span>.</span></div>' +
      '<div class="search-box"><input type="text" id="searchInput" placeholder="Tìm sách, tác giả, thể loại..." value="' + esc(searchVal) + '" onkeyup="if(event.key===\'Enter\')triggerSearch()"></div>' +
      '<div class="user"><button class="btn btn-ghost' + (tab === 'books' ? ' active' : '') + '" onclick="go(\'books\')">📚 Sách<span id="cartBadge"></span></button><button class="btn btn-primary" onclick="go(\'login\')">Đăng nhập</button></div></div></div>';
  } else {
    header = '<div class="header-wrapper"><div class="header"><div class="logo" style="cursor:pointer" onclick="go(\'books\')">🌿 Bookstore<span>.</span></div>' +
      '<div class="search-box"><input type="text" id="searchInput" placeholder="Tìm sách, tác giả, thể loại..." value="' + esc(searchVal) + '" onkeyup="if(event.key===\'Enter\')triggerSearch()"></div>' +
      '<div class="user"><button class="btn btn-ghost' + (tab === 'books' ? ' active' : '') + '" onclick="go(\'books\')">📚 Sách<span id="cartBadge"></span></button><button class="btn btn-ghost' + (tab === 'orders' ? ' active' : '') + '" onclick="go(\'orders\')">📦 Đơn hàng</button><button class="btn btn-ghost' + (tab === 'profile' ? ' active' : '') + '" onclick="go(\'profile\')">👤 ' + esc(customer.full_name) + '</button><button class="btn btn-danger" onclick="logout()">Đăng xuất</button></div></div></div>';
  }
  
  var body = '<div class="container">';
  if (tab === 'login') {
    body += '<div class="login-box" id="loginBox"><h2>🌿 Cổng Đăng Nhập</h2><p class="muted" style="margin-top:2px;font-size:13px;">Đăng nhập để đặt hàng và xem thông tin phân khúc thành viên</p><div class="err" id="err"></div><label>Tài Khoản Email</label><input id="loginEmail" value="customer@test.local"><label>Mật Khẩu</label><input id="loginPass" type="password" value="customer123"><button class="btn btn-primary" style="width:100%;margin-top:20px;padding:12px;" onclick="login()">Đăng nhập bằng Mật Khẩu</button><button class="btn btn-accent" style="width:100%;margin-top:8px;padding:12px;" onclick="showLoginOtp()">🔑 Đăng Nhập Nhanh Bằng Mã OTP</button><div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:13px;" class="muted">Chưa có tài khoản? <a href="#" style="color:var(--primary);font-weight:700;text-decoration:none;" onclick="showRegister()">Đăng ký tài khoản</a></div></div>';
  } else if (tab === 'books') {
    body += renderBooks();
  } else if (tab === 'orders') {
    if (!token || !customer) {
      body += '<div class="card" style="text-align:center;padding:40px 24px;"><h3>📦 Đơn hàng của tôi</h3><p class="muted" style="margin-bottom:16px;">Vui lòng đăng nhập để xem lịch sử mua hàng và trạng thái vận chuyển.</p><button class="btn btn-primary" onclick="go(\'login\')">Đăng nhập ngay</button></div>';
    } else {
      body += '<div class="card"><h3>📦 Đơn hàng của tôi</h3><div id="ordersList" class="muted">Đang tải lịch sử đơn hàng...</div></div>';
    }
  } else if (tab === 'profile') {
    if (!token || !customer) {
      body += '<div class="card" style="text-align:center;padding:40px 24px;"><h3>👤 Hồ sơ cá nhân</h3><p class="muted" style="margin-bottom:16px;">Vui lòng đăng nhập để quản lý tài khoản và xem lịch sử phản hồi.</p><button class="btn btn-primary" onclick="go(\'login\')">Đăng nhập ngay</button></div>';
    } else {
      body += '<div class="card"><h3>👤 Hồ sơ khách hàng</h3><div id="profileInfo" class="muted">Đang tải thông tin hồ sơ...</div></div>';
    }
  }
  body += '</div>';
  root.innerHTML = header + body;
  
  if (tab === 'books') {
    loadBooks();
    renderCartBadge();
  } else if (tab === 'orders') {
    if (token && customer) loadOrders();
  } else if (tab === 'profile') {
    if (token && customer) loadProfile();
  }
}
window.render = render;
window.showRegister = showRegister;
window.showLoginOtp = showLoginOtp;
window.sendOtp = sendOtp;
window.verifyOtp = verifyOtp;
window.login = login;
window.register = register;
window.triggerSearch = triggerSearch;
window.logout = logout;
window.go = go;

function renderBooks() {
  var userGreeting = customer ? 'Chào mừng bạn trở lại, <span>' + esc(customer.full_name) + '</span>!' : 'Chào mừng đến với <span>Bookstore</span>!';
  var subGreeting = customer ? 'Khám phá tri thức thế giới cùng với các ưu đãi thành viên dành riêng cho bạn.' : 'Hãy đăng nhập để hưởng ưu đãi đặc quyền, lưu đơn hàng và viết đánh giá sách.';
  
  var heroHtml = '<div class="hero">' +
    '<h1>' + userGreeting + '</h1>' +
    '<p>' + subGreeting + '</p>' +
  '</div>';

  return heroHtml + '<div style="display:flex;gap:24px;flex-wrap:wrap"><div style="flex:1;min-width:300px"><div class="card"><h3>Danh mục sách</h3><div class="grid" id="booksGrid"><span class="muted">Đang tải danh sách sách...</span></div></div></div>' +
    '<div style="width:340px;display:flex;flex-direction:column;gap:20px">' +
    '<div id="segmentCard" style="display:none"></div>' +
    '<div class="card" style="position:sticky;top:90px;"><h3>🛒 Giỏ hàng mua sắm</h3><div id="cartPanel"><span class="muted">Đang tải giỏ hàng...</span></div></div>' +
    '</div></div>';
}

async function loadBooks() {
  try {
    var books = await api('/api/customer/books');
    var q = '';
    var searchInput = el('searchInput');
    if (searchInput) {
      q = searchInput.value.trim().toLowerCase();
    } else {
      q = (new URLSearchParams(location.search).get('search') || '').toLowerCase();
    }
    if (q) {
      books = books.filter(function(b) {
        return (b.title||'').toLowerCase().includes(q) || (b.author||'').toLowerCase().includes(q) || (b.category||'').toLowerCase().includes(q);
      });
    }
    var grid = el('booksGrid');
    if (!grid) return;
    if (!books.length) {
      var displayQ = q || '';
      grid.innerHTML = '<div style="text-align:center;padding:40px 0;width:100%;grid-column:1/-1;"><span class="muted" style="font-size:14px;">' + (displayQ ? '🔍 Không tìm thấy cuốn sách nào phù hợp với "' + esc(displayQ) + '"' : 'Hiện chưa có sách nào trong cửa hàng.') + '</span></div>';
      return;
    }
    grid.innerHTML = books.map(function(b) {
      var inCart = cart.find(function(i) { return i.book_id === b.id; });
      var canBuy = b.stock_quantity > 0 && b.is_active;
      var coverHtml = b.cover_document_id
        ? '<img src="/api/customer/documents/' + b.cover_document_id + '/cover?token=' + encodeURIComponent(token) + '" alt="' + esc(b.title) + '" onerror="this.style.display=\'none\'; this.parentElement.innerHTML = window.generateDefaultCover(\'' + esc(b.title).replace(/'/g,"\\'") + '\',\'' + esc(b.author||'').replace(/'/g,"\\'") + '\',\'' + esc(b.category||'').replace(/'/g,"\\'") + '\')">'
        : generateDefaultCover(b.title, b.author, b.category);
      return '<div class="book-card" onclick="location.href=\'product.html?id=' + b.id + '\'">' +
        '<div class="book-card-cover">' + coverHtml + '</div>' +
        '<div class="book-card-info">' +
          '<h4>' + esc(b.title) + '</h4>' +
          '<p class="author">' + esc(b.author||'Chưa rõ tác giả') + '</p>' +
          '<span class="pill" style="align-self:flex-start;font-size:10px;padding:2px 8px;margin-top:2px;">' + esc(b.category||'Khác') + '</span>' +
          '<div class="price-row">' +
            '<span class="price">' + money(b.sale_price) + '</span>' +
            '<span class="muted" style="font-size:11px;font-weight:600;">' + (canBuy ? 'Còn ' + b.stock_quantity + ' c' : 'Hết hàng') + '</span>' +
          '</div>' +
          '<div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,0.04);">' +
            (canBuy ? '<button class="btn btn-primary btn-sm" style="width:100%;font-size:12px;padding:8px 12px;" onclick="event.stopPropagation();addToCart(' + b.id + ',\'' + esc(b.title).replace(/'/g,"\\'") + '\',' + b.sale_price + ',' + b.stock_quantity + ')">🛒 Cho vào giỏ ' + (inCart ? '<b>(' + inCart.quantity + ')</b>' : '') + '</button>' : '<span class="pill" style="opacity:0.5;text-align:center;display:block;width:100%;background:#e0e0e0;color:#616161;">Hết hàng tạm thời</span>') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    renderCartPanel();
    // Load segment info
    if (token && customer) {
      loadSegmentInfo();
    } else {
      var card = el('segmentCard');
      if (card) card.style.display = 'none';
    }
  } catch(e) { var g = el('booksGrid'); if (g) g.innerHTML = '<div style="color:var(--danger);padding:20px;grid-column:1/-1;">Lỗi tải dữ liệu: ' + esc(e.message) + '</div>'; }
}
window.loadBooks = loadBooks;

async function loadSegmentInfo() {
  try {
    var me = _meCache || await api('/api/customer/me');
    _meCache = me;
    var card = el('segmentCard');
    if (!card) return;
    if (!me.segment || me.segment === 'Chưa đủ dữ liệu') {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';
    var seg = me.segment;
    var color = segmentColor(seg);
    var emoji = segmentEmoji(seg);
    var bg = segmentBg(seg);
    
    // Calculate progress (fake progress bar for gamified styling)
    var percent = 30;
    var nextLimit = '500,000đ';
    var nextTier = 'Thân Thiết';
    if (seg === 'Khách vãng lai') { percent = Math.min(100, Math.round((me.total_spent / 200000) * 100)); nextLimit = '200,000đ'; nextTier = 'Thân Thiết'; }
    else if (seg === 'Khách thân thiết') { percent = Math.min(100, Math.round((me.total_spent / 1000000) * 100)); nextLimit = '1,000,000đ'; nextTier = 'Thành Viên VIP'; }
    else if (seg === 'VIP') { percent = 100; nextTier = 'Đỉnh Cao'; nextLimit = 'Tối Đa'; }
    else if (seg === 'Học sinh / Sinh viên') { percent = 100; nextTier = 'HS-SV Ưu Đãi'; nextLimit = 'Mức Ưu Đãi Cố Định'; }

    card.innerHTML = 
      '<div class="member-card-widget" style="background: ' + bg + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
          '<div>' +
            '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.75;font-weight:700;">Hạng Thành Viên</div>' +
            '<div style="font-size:18px;font-weight:900;font-family:var(--font-title);color:' + color + ';margin-top:2px;">' + emoji + ' ' + segmentLabel(seg) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="margin-top:16px;font-size:11px;opacity:0.85;display:flex;justify-content:space-between;">' +
          '<span>Tiến trình nâng hạng tiếp theo</span>' +
          '<span>' + percent + '%</span>' +
        '</div>' +
        '<div class="member-progress"><div class="member-progress-bar" style="width:' + percent + '%;background:' + color + '"></div></div>' +
        '<div style="font-size:10px;opacity:0.75;margin-top:6px;text-align:right;">Mục tiêu: ' + nextLimit + ' lên hạng ' + nextTier + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px;border-top:1px solid rgba(255,255,255,0.1);padding-top:12px;">' +
          '<div>' +
            '<div style="font-size:9px;opacity:0.7;text-transform:uppercase;">Tổng Tích Lũy</div>' +
            '<div style="font-size:14px;font-weight:800;color:' + color + ';font-family:var(--font-title);">' + money(me.total_spent) + '</div>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:9px;opacity:0.7;text-transform:uppercase;">Tổng Số Đơn</div>' +
            '<div style="font-size:14px;font-weight:800;color:' + color + ';font-family:var(--font-title);">' + (me.order_count || 0) + ' đơn</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  } catch(e) { /* segment widget optional */ }
}
window.loadSegmentInfo = loadSegmentInfo;

async function loadOrders() {
  try {
    _meCache = null;
    var me = await api('/api/customer/me');
    _meCache = me;
    var orders = me.orders || [];
    var div = el('ordersList');
    if (!div) return;
    if (!orders.length) { div.innerHTML = '<div style="text-align:center;padding:30px 0;"><p class="muted">Bạn chưa có đơn hàng nào trong hệ thống.</p><button class="btn btn-primary" style="margin-top:12px;" onclick="go(\'books\')">Mua sách ngay</button></div>'; return; }
    var statusLabels = { new:'Mới', paid:'Đã Thanh Toán', shipping:'Đang Giao Hàng', completed:'Hoàn Thành', cancelled:'Đã Hủy' };
    div.innerHTML = '<table style="margin-top:12px;"><thead><tr><th>Mã Đơn Hàng</th><th>Ngày Đặt</th><th>Tổng Hóa Đơn</th><th style="text-align:center;">Trạng Thái</th></tr></thead><tbody>' +
      orders.map(function(o) {
        var statusClass = o.status === 'completed' ? 'success' : (o.status === 'cancelled' ? 'danger' : '');
        var statusLabel = statusLabels[o.status] || o.status;
        return '<tr>' +
          '<td style="font-family:var(--font-title);font-weight:800;color:var(--primary);">' + esc(o.order_code) + '</td>' +
          '<td>' + fmtTime(o.created_at) + '</td>' +
          '<td class="money" style="font-weight:700;color:var(--danger);">' + money(o.total) + '</td>' +
          '<td style="text-align:center;"><span class="pill ' + statusClass + '">' + statusLabel + '</span></td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  } catch(e) {
    // Chỉ logout khi lỗi 401 thực sự (Chưa đăng nhập), không logout vì lỗi khác
    if (String(e.message) === 'Chưa đăng nhập') {
      logout();
      go('login');
      return;
    }
    var d = el('ordersList');
    if (d) d.innerHTML = '<span style="color:var(--danger)">Lỗi tải đơn hàng: ' + esc(e.message) + '</span>';
  }
}
window.loadOrders = loadOrders;

async function loadProfile() {
  try {
    var me = _meCache || await api('/api/customer/me');
    _meCache = me;
    var div = el('profileInfo');
    if (!div) return;
    
    // Segment info in profile too
    var segHtml = '';
    if (me.segment && me.segment !== 'Chưa đủ dữ liệu') {
      var segColor = segmentColor(me.segment);
      var segEmoji = segmentEmoji(me.segment);
      var segBg = segmentBg(me.segment);
      segHtml = '<div class="member-card-widget" style="background:' + segBg + ';margin-bottom:24px;max-width:400px;">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;opacity:0.75;font-weight:700;">Hạng Thành Viên Đặc Quyền</div>' +
        '<div style="font-size:22px;font-weight:900;font-family:var(--font-title);color:' + segColor + ';margin-top:2px;">' + segEmoji + ' ' + segmentLabel(me.segment) + '</div>' +
        '<div style="font-size:12px;opacity:0.8;margin-top:4px;">Tổng tích lũy: ' + money(me.total_spent) + ' • Đã đặt ' + (me.order_count||0) + ' đơn hàng</div>' +
      '</div>';
    }
    
    div.innerHTML = segHtml + 
      '<div class="grid" style="margin-bottom:28px;">' +
        '<div class="stat" style="background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:16px;">' +
          '<span style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Họ và Tên</span>' +
          '<b style="display:block;font-size:18px;color:var(--primary);font-family:var(--font-title);margin-top:4px;">' + esc(me.full_name) + '</b>' +
        '</div>' +
        '<div class="stat" style="background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:16px;">' +
          '<span style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Địa chỉ Email</span>' +
          '<b style="display:block;font-size:18px;color:var(--primary);font-family:var(--font-title);margin-top:4px;word-break:break-all;">' + esc(me.email) + '</b>' +
        '</div>' +
        '<div class="stat" style="background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:16px;">' +
          '<span style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Số Điện Thoại</span>' +
          '<b style="display:block;font-size:18px;color:var(--primary);font-family:var(--font-title);margin-top:4px;">' + esc(me.phone||'Chưa cập nhật') + '</b>' +
        '</div>' +
        '<div class="stat" style="background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:16px;">' +
          '<span style="font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;">Tổng Số Đơn Hàng</span>' +
          '<b style="display:block;font-size:18px;color:var(--primary);font-family:var(--font-title);margin-top:4px;">' + (me.orders||[]).length + ' đơn</b>' +
        '</div>' +
      '</div>';
    
    // Feedback history with images
    var feedbacks = me.feedbacks || [];
    if (feedbacks.length) {
      var sentimentLabels = { positive: 'Tích cực', negative: 'Tiêu cực', neutral: 'Trung lập' };
      var reviewCards = feedbacks.map(function(r) {
        var stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
        var tagsHtml = (r.tags||[]).map(function(t){ return '<span class="pill" style="margin-right:6px;">' + esc(t) + '</span>'; }).join('');
        // Media thumbnails
        var mediaHtml = '';
        if (r.media && r.media.length) {
          var mediaUrls = r.media.map(function(m) { return m.url; });
          mediaHtml = '<div class="review-thumbs" style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
            r.media.map(function(m, idx) {
              return '<img src="' + m.url + '" style="width:64px;height:64px;object-fit:cover;border-radius:8px;cursor:pointer;border:1.5px solid var(--border);transition:all 0.2s;" onclick="window.feedbackMedia(' + JSON.stringify(mediaUrls) + ',' + idx + ')" onmouseover="this.style.transform=\'scale(1.08)\'" onmouseout="this.style.transform=\'none\'">';
            }).join('') + '</div>';
        }
        var sentimentClass = r.sentiment === 'positive' ? 'success' : (r.sentiment === 'negative' ? 'danger' : '');
        return '<div style="border:1px solid var(--border);border-radius:16px;padding:16px;margin:12px 0;background:#fafafa;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">' +
            '<div>' +
              '<span class="pill ' + sentimentClass + '">' + esc(sentimentLabels[r.sentiment] || r.sentiment) + '</span>' +
              '<span style="color:var(--accent);margin-left:8px;font-size:14px;">' + stars + '</span>' +
            '</div>' +
            '<span style="font-size:12px;font-weight:700;color:var(--primary);font-family:var(--font-title);">' + esc(r.book_title) + '</span>' +
          '</div>' +
          '<p style="font-size:13.5px;color:var(--text);font-family:var(--font-body);line-height:1.5;">' + esc(r.comment) + '</p>' +
          (tagsHtml ? '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:4px;">' + tagsHtml + '</div>' : '') +
          mediaHtml +
          '</div>';
      }).join('');
      div.innerHTML += '<div style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px;"><h4>📝 Lịch Sử Đánh Giá Sách (' + feedbacks.length + ')</h4>' + reviewCards + '</div>';
    }
  } catch(e) { 
    if (String(e.message).includes('Token') || String(e.message).includes('hợp lệ') || String(e.message).includes('Chưa đăng nhập')) { 
      logout(); 
      go('login'); 
      return; 
    } 
    var d = el('profileInfo'); 
    if (d) d.innerHTML = '<span style="color:var(--danger)">Lỗi: ' + esc(e.message) + '</span>'; 
  }
}
window.loadProfile = loadProfile;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', render);
} else {
  render();
}
