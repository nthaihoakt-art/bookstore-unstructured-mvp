require('dotenv').config();
const OpenAI = require('openai');

function getClient() {
  const apiKey = process.env.AI_API_KEY;
  const baseURL = process.env.AI_BASE_URL;
  const model = process.env.AI_MODEL;

  if (!apiKey || !baseURL || !model) {
    throw new Error('Thiếu cấu hình AI trong .env. Cần: AI_API_KEY, AI_BASE_URL, AI_MODEL');
  }

  return { client: new OpenAI({ apiKey, baseURL }), model };
}

function parseJSONResponse(text) {
  try {
    const cleaned = text.replace(/```json\s?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function classifyDocument(text) {
  if (!text || !text.trim()) return { type: 'internal', confidence: 0 };

  const { client, model } = getClient();
  const prompt = `Classify this document text into exactly ONE type: invoice (hóa đơn), contract (hợp đồng), cover (ảnh bìa), inventory_note (ghi chú kho), customer_feedback (phản hồi khách), book_description (mô tả sách), internal (nội bộ khác).

Return JSON only: {"type":"...","confidence":0.0-1.0}

Document text:
${text.slice(0, 3000)}`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 2048
    });
    const raw = (res.choices[0]?.message?.content || '').trim();
    const parsed = parseJSONResponse(raw);
    if (parsed && parsed.type) {
      const validTypes = ['invoice', 'contract', 'cover', 'inventory_note', 'customer_feedback', 'book_description', 'internal'];
      return {
        type: validTypes.includes(parsed.type) ? parsed.type : 'internal',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
      };
    }
    return { type: 'internal', confidence: 0 };
  } catch (e) {
    throw new Error('AI classification failed: ' + (e.message || 'unknown error'));
  }
}

async function summarizeDocument(text) {
  if (!text || !text.trim()) throw new Error('Không có nội dung để tóm tắt');

  const { client, model } = getClient();
  const prompt = `Tóm tắt tài liệu sau bằng 2-3 câu tiếng Việt. Tập trung vào: tên người/tổ chức, số tiền, ngày tháng, số lượng, sự kiện chính.

Chỉ trả lời bằng văn bản thuần (plain text), không dùng JSON hay markdown.

Nội dung tài liệu:
${text.slice(0, 3000)}`;

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2048
  });

  const raw = (res.choices[0]?.message?.content || '').trim();
  return { summary: raw.replace(/```[\s\S]*?```/g, '').replace(/^JSON:\s*/i, '').trim() };
}

function generateFallbackAnswer(question, contextDocs = []) {
  if (contextDocs && contextDocs.length > 0) {
    const details = contextDocs.map(d => {
      const snippet = d.snippet || d.text || '';
      return `• **${d.title}** (${d.doc_type || 'tài liệu'}):\n  ${snippet}`;
    }).join('\n\n');
    return {
      answer: `Tìm thấy ${contextDocs.length} kết quả phù hợp trong kho dữ liệu nhà sách:\n\n${details}`
    };
  }
  return {
    answer: 'Không tìm thấy thông tin hoặc tài liệu phù hợp với câu hỏi của bạn trong hệ thống.'
  };
}

async function chatWithContext(question, contextDocs = [], history = []) {
  if (!question || !question.trim()) throw new Error('Câu hỏi trống');

  let clientInfo;
  try {
    clientInfo = getClient();
  } catch (err) {
    console.warn('[AI Service] Cấu hình AI thiếu hoặc lỗi, chuyển sang trả lời bằng dữ liệu nội bộ:', err.message);
    return generateFallbackAnswer(question, contextDocs);
  }

  const { client, model } = clientInfo;

  const contextBlock = contextDocs.length
    ? contextDocs.map((d, i) => `[Tài liệu ${i + 1}] ${d.title} (loại: ${d.doc_type})
${d.snippet || d.text || ''}`).join('\n\n')
    : 'Không tìm thấy tài liệu liên quan trong kho.';

  // Build conversation memory from history
  const memoryBlock = history.length > 0
    ? 'Lịch sử hội thoại:\n' + history.map(m => (m.role === 'user' ? 'User' : 'AI') + ': ' + m.content).join('\n')
    : '';

  const wasWarned = history.some(m =>
    m.role === 'assistant' && (m.content.toLowerCase().includes('đừng hỏi lung tung') || m.content.includes('Đã bảo tốn token'))
  );

  const offTopicGuard = wasWarned
    ? 'CẢNH BÁO: Người dùng đã hỏi câu không liên quan lần thứ 2. BẮT BUỘC trả lời CHÍNH XÁC: "Đã bảo tốn token mà 😤"'
    : 'Nếu câu hỏi không liên quan gì đến sách, tài liệu, nhà sách, VÀ lịch sử hội thoại cũng không liên quan đến sách → BẮT BUỘC trả lời: "Bạn ơi tôi chỉ trả lời về sách và tài liệu trong nhà sách thôi. Đừng hỏi lung tung tốn token nha 😅"';

  const systemPrompt = `Bạn là trợ lý của Nhà sách — hệ thống quản lý dữ liệu phi cấu trúc.
Nhiệm vụ: Trả lời câu hỏi về sách, tác giả, hóa đơn, hợp đồng, tài liệu trong kho.

${memoryBlock}

${offTopicGuard}

Nguyên tắc:
- Dùng lịch sử hội thoại để hiểu ngữ cảnh. Câu hỏi ngắn như "kiếm trên web coi", "tìm thêm đi", "còn cuốn nào nữa không" là follow-up của câu trước.
- Nếu có tài liệu: trả lời chi tiết dựa trên NỘI DUNG, trích dẫn tên tài liệu nguồn.
- Nếu không có tài liệu: nói "Không tìm thấy thông tin trong kho tài liệu."
- Trả lời ngắn gọn, tiếng Việt, text thuần.

Tài liệu tham khảo:
${contextBlock}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6),
    { role: 'user', content: question }
  ];

  try {
    const res = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.5,
      max_tokens: 4096
    });

    return { answer: res.choices[0]?.message?.content || 'Không thể tạo câu trả lời.' };
  } catch (err) {
    console.warn('[AI Service] Lỗi gọi API AI (Token/Network), tự động dùng kết quả tìm kiếm nội bộ:', err.message);
    return generateFallbackAnswer(question, contextDocs);
  }
}

async function lookupBookInfo(bookName) {
  // ── Cleanup bookName ──
  let cleaned = bookName
    .replace(/\b(thêm sách|nhập sách|tạo sách|thêm mới|add book|tôi cần|tôi muốn|cho tôi|nhập|cuốn sách|cuốn|quyển sách|quyển)\b/gi, '')
    .replace(/nếu ko thấy.*$/gi, '')
    .replace(/nếu không thấy.*$/gi, '')
    .replace(/\b(\w+)\s+\1\b/g, '$1') // deduplicate immediate repeats
    .trim();

  // Nếu chứa "của" → phần trước là tên sách
  const cuaIdx = cleaned.search(/\bcủa\b/i);
  if (cuaIdx > 5) cleaned = cleaned.slice(0, cuaIdx).trim();

  // Deduplicate repeated words (non-consecutive)
  const parts = cleaned.split(/\s+/);
  const seen = new Set();
  const deduped = parts.filter(function(w) {
    const lower = w.toLowerCase();
    if (seen.has(lower)) return false;
    if (/^\d+$/.test(w)) { if (seen.has('__num__')) return false; seen.add('__num__'); return true; }
    seen.add(lower);
    return true;
  });
  cleaned = deduped.join(' ');

  // Validate
  if (!cleaned || cleaned.length < 5 || /^[\d\s,.-]+$/.test(cleaned)) {
    return { error: 'Tên sách không hợp lệ' };
  }

  let clientInfo;
  try {
    clientInfo = getClient();
  } catch (err) {
    return { title: cleaned, author: '', category: '', publisher: '', description: 'Tạo nhanh cuốn ' + cleaned, estimated_price: 100000 };
  }
  const { client, model } = clientInfo;
  const prompt = `Cho biết thông tin về cuốn sách "${cleaned}".`;

  let raw = '';
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2048
    });
    raw = (res.choices[0]?.message?.content || '').trim();
  } catch (err) {
    console.warn('[AI Service] Lỗi tra cứu sách qua AI:', err.message);
    return { title: cleaned, author: '', category: '', publisher: '', description: 'Tạo nhanh cuốn ' + cleaned, estimated_price: 100000 };
  }
  if (!raw || raw.length < 15 || raw.includes('xin lỗi') || raw.includes('không có thông tin')) return { error: 'Không tìm thấy thông tin sách' };

  const info = { title: cleaned, author: '', category: '', publisher: '', published_year: null, pages: null, isbn: '', language: 'vi', description: '', estimated_price: 0 };

  // Strip markdown formatting for easier regex matching
  const plain = raw.replace(/\*\*/g, '').replace(/#{1,4}\s*/g, '').replace(/\*/g, '');

  const authorMatch = plain.match(/tác giả\s*[\n:–-]+\s*(.+?)(?:[,\n.]\s*(?:là|sinh|sinh năm|quốc tịch|\(|năm|$)|$)/i);
  if (authorMatch) info.author = authorMatch[1].trim();
  if (!info.author) {
    const m = plain.match(/(?:tác giả|của|viết bởi|author)[:\s]+(.+?)(?:[,\n]|$)/i);
    if (m) info.author = m[1].trim();
  }

  const catMatch = plain.match(/thể loại\s*[\n:–-]+\s*(.+?)(?:[,\n]|$)/i);
  if (catMatch) info.category = catMatch[1].trim();

  const pubMatch = plain.match(/(?:nhà xuất bản|NXB|nhà xuất bản|publisher)\s*[\n:–-]+\s*(.+?)(?:[,\n]|$)/i);
  if (pubMatch) info.publisher = pubMatch[1].trim();

  const yearMatch = plain.match(/(?:năm| xuất bản|phát hành|công bố)[:\s]+(\d{4})/i) || plain.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
  if (yearMatch) info.published_year = parseInt(yearMatch[1]);

  const pageMatch = plain.match(/(?:số trang|trang|pages?)[:\s]+(\d+)/i) || plain.match(/(\d+)\s*trang/i);
  if (pageMatch) info.pages = parseInt(pageMatch[1]);

  const isbnMatch = plain.match(/ISBN[:\s]*([\d-]+)/i);
  if (isbnMatch) info.isbn = isbnMatch[1].trim();

  const descMatch = plain.match(/(?:mô tả|tóm tắt|nội dung|giới thiệu|về cuốn sách|tổng quan)[:\s]+(.+)/i);
  if (descMatch) info.description = descMatch[1].trim().slice(0, 300);
  if (!info.description && plain.length > 50) info.description = plain.replace(/tác giả.*?(?:[,\n]|$)/gi, '').replace(/thể loại.*?(?:[,\n]|$)/gi, '').replace(/NXB.*?(?:[,\n]|$)/gi, '').replace(/năm.*?\d{4}[,\n.]/gi, '').replace(/ISBN.*?(?:[,\n]|$)/gi, '').trim().slice(0, 200);

  const priceMatch = plain.match(/(?:giá bìa|giá tham khảo|giá)[:\s]+(\d{2,7})\s*(?:đ|VND|đồng|vnđ)?/i) || plain.match(/(\d{2,7})\s*(?:đ|VND|đồng|vnđ)/);
  if (priceMatch) info.estimated_price = parseInt(priceMatch[1]);

  // [FIX 3] Chap nhan neu co estimated_price hoac description
  if (!info.author && !info.publisher && !info.category && !info.estimated_price && !info.description) return { error: 'Không tìm thấy thông tin sách' };
  return info;
}

function heuristicParseBookIntent(question, dbBooks, session) {
  const q = String(question || '').trim();
  const qLower = q.toLowerCase();

  if (/^(ok|ừ|được|chốt|đồng ý|yes|y)$/i.test(qLower)) return { intent: 'confirm' };
  if (/^(không|hủy|thôi|bỏ|no|n)$/i.test(qLower)) return { intent: 'reject' };

  // Nhập/xuất kho: ví dụ "Nhập thêm 10 cuốn Sapiens"
  const stockMatch = q.match(/(nhập thêm|nhập|xuất kho|xuất)\s+(\d+)\s*(cuốn|quyển)?\s*(.*)/i);
  if (stockMatch) {
    const action = stockMatch[1].includes('xuất') ? 'out' : 'in';
    const qty = parseInt(stockMatch[2], 10);
    const bookNameQuery = (stockMatch[4] || '').trim().toLowerCase();
    let matchedBook = null;
    if (dbBooks && dbBooks.length > 0) {
      matchedBook = dbBooks.find(b => b.title && b.title.toLowerCase().includes(bookNameQuery));
    }
    return {
      intent: 'adjust_stock',
      quantity: qty,
      action,
      book_id: matchedBook ? matchedBook.id : (dbBooks && dbBooks[0] ? dbBooks[0].id : null)
    };
  }

  // Thêm sách
  const addMatch = q.match(/(thêm sách|nhập sách|tạo sách|add book)\s+(.*)/i);
  if (addMatch) {
    return { intent: 'add_book', book_name: addMatch[2].trim() };
  }

  return { intent: 'irrelevant', message: 'Xin lỗi, tôi không thể xử lý câu lệnh này.' };
}

async function parseBookIntent(question, dbBooks, session) {
  let clientInfo;
  try {
    clientInfo = getClient();
  } catch (err) {
    console.warn('[AI Service] API AI lỗi/thiếu config, tự động chuyển sang phân tích quy tắc:', err.message);
    return heuristicParseBookIntent(question, dbBooks, session);
  }

  const { client, model } = clientInfo;

  const booksJson = dbBooks && dbBooks.length > 0
    ? JSON.stringify(dbBooks.slice(0, 2).map(b => ({ id: b.id, title: b.title })))
    : '';

  const sessionJson = session
    ? JSON.stringify({ step: session.step, pendingAction: session.pendingAction, bookTitle: session.bookInfo?.title || session.bookTitle })
    : '';

  const prompt = `Phân tích câu nói của user. Trả JSON.

User: "${question}"
${booksJson ? 'DB: ' + booksJson : ''}
${sessionJson ? 'Session: ' + sessionJson : ''}

Quy tắc:
- Thêm/nhập/tạo/add sách (bằng tiếng Anh hoặc tiếng Việt) → {"intent":"add_book","book_name":"tên sách"}
  * Nếu câu hỏi nhắc đến nhiều tên sách, chỉ lấy tên sách ĐẦU TIÊN được đề cập.
  * Ví dụ: "add cuốn Quốc gia khởi nghiệp vs Cam kết" → book_name = "Quốc gia khởi nghiệp"
- Tăng giá hoặc giảm giá sách → {"intent":"adjust_price","book_id":id từ DB,"new_price":số}
- Ngưng bán/ngừng bán → {"intent":"toggle_active","book_id":id từ DB,"action":"deactivate"}
- Nhập thêm/xuất kho → {"intent":"adjust_stock","book_id":id từ DB,"quantity":số,"action":"in"|"out"}
- Sửa/cập nhật → {"intent":"update_info","book_id":id từ DB,"field":"tên field","value":"giá trị"}
- Trả lời số tiền khi Session=awaiting_price → {"intent":"set_price","import_price":số}
- Xác nhận (ok/ừ/được/chốt) → {"intent":"confirm"}
- Từ chối (không/hủy/thôi) → {"intent":"reject"}
- Còn lại → {"intent":"irrelevant"}

CHỈ JSON.`;

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 2048
    });

    const raw = (res.choices[0]?.message?.content || '').trim();
    const parsed = parseJSONResponse(raw);
    return parsed || heuristicParseBookIntent(question, dbBooks, session);
  } catch (err) {
    console.warn('[AI Service] Lỗi gọi API AI, dùng quy tắc heuristic:', err.message);
    return heuristicParseBookIntent(question, dbBooks, session);
  }
}

function heuristicFeedbackSentiment(text) {
  const t = String(text || '').toLowerCase();
  const negativeWords = ['t?', 'd?', 'k?m', 'x?u', 'ch?m', 'l?u', 'r?ch', 'b?n', 'sai', 'l?i', 'th?t v?ng', 'kh?ng h?i l?ng', 'kh?ng ?n', '??t', 'm?c', 'h?ng', 'thi?u'];
  const positiveWords = ['hay', 't?t', '??p', 'nhanh', '?n', 'th?ch', 'h?i l?ng', 'tuy?t', 'xu?t s?c', '??ng mua', 'ok', '?ng'];
  const neg = negativeWords.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  const pos = positiveWords.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  if (neg > pos) return { sentiment: 'negative', score: Math.min(0.95, 0.55 + neg * 0.12) };
  if (pos > neg) return { sentiment: 'positive', score: Math.min(0.95, 0.55 + pos * 0.12) };
  return { sentiment: 'neutral', score: 0.5 };
}

async function analyzeFeedbackSentiment(text) {
  if (!text || !text.trim()) return { sentiment: 'neutral', score: 0.5 };
  const fallback = heuristicFeedbackSentiment(text);
  try {
    const { client, model } = getClient();
    const prompt = `Ph?n lo?i c?m x?c nh?n x?t kh?ch h?ng mua s?ch th?nh ??ng 1 trong 3 nh?n: positive, negative, neutral.
- positive: khen r? r?ng/h?i l?ng.
- negative: ch?, ph?n n?n, l?i, th?t v?ng, giao ch?m, s?ch h?ng/sai.
- neutral: ch? m? t?, h?i, ho?c kh?ng r? khen/ch?.
Kh?ng m?c ??nh positive n?u c?u m? h?. Tr? JSON duy nh?t: {"sentiment":"positive|negative|neutral","score":0.0-1.0}.
Nh?n x?t: "${text.slice(0, 500)}"`;
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 256
    });
    const raw = (res.choices[0]?.message?.content || '').trim();
    const parsed = parseJSONResponse(raw);
    if (parsed && parsed.sentiment) {
      const validSentiments = ['positive', 'negative', 'neutral'];
      const sentiment = validSentiments.includes(parsed.sentiment) ? parsed.sentiment : fallback.sentiment;
      return { sentiment, score: typeof parsed.score === 'number' ? parsed.score : fallback.score };
    }
    return fallback;
  } catch (e) {
    console.error('Sentiment analysis error, falling back to heuristic:', e.message);
    return fallback;
  }
}


module.exports = { classifyDocument, summarizeDocument, chatWithContext, lookupBookInfo, parseBookIntent, analyzeFeedbackSentiment };
