const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const ACTION_LABELS = {
  create: 'Tạo mới',
  update: 'Cập nhật',
  delete: 'Xóa',
  upload: 'Tải lên',
  download: 'Tải xuống',
  login: 'Đăng nhập',
  logout: 'Đăng xuất',
  cancel: 'Hủy',
  reprocess: 'Xử lý lại OCR',
  ai_classify: 'AI phân loại',
  ai_summarize: 'AI tóm tắt',
  update_status: 'Cập nhật trạng thái',
  update_permissions: 'Cập nhật quyền',
  deactivate: 'Vô hiệu hóa',
};

const ENTITY_LABELS = {
  book: 'Sách',
  customer: 'Khách hàng',
  order: 'Đơn hàng',
  supplier: 'Nhà cung cấp',
  document: 'Tài liệu',
  inventory_slip: 'Phiếu kho',
  inventory_transaction: 'Giao dịch kho',
  user: 'Người dùng',
  role: 'Vai trò',
  feedback: 'Đánh giá',
};

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function getLogPath(dateStr) {
  return path.join(logsDir, `${dateStr}.log`);
}

function isMongoActive() {
  try {
    return mongoose.connection && mongoose.connection.readyState === 1 && mongoose.models.AuditLog;
  } catch (e) {
    return false;
  }
}

function writeLog({ userName, userEmail, action, entityType, entityId, details }) {
  if (isMongoActive()) {
    return (async () => {
      try {
        const AuditLog = mongoose.model('AuditLog');
        const log = new AuditLog({
          userId: null,
          action,
          entityType,
          entityId: entityId != null ? String(entityId) : null,
          details: JSON.stringify({ userName, userEmail, ...(details || {}) })
        });
        await log.save();
      } catch (e) {
        console.error('[LogService] Lỗi ghi audit log MongoDB:', e.message);
      }
    })();
  }

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString('vi-VN', { hour12: false });
    const actionLabel = ACTION_LABELS[action] || action;
    const entityLabel = ENTITY_LABELS[entityType] || entityType;
    let detailParts = [];
    if (details) {
      if (details.email) detailParts.push(`email: ${details.email}`);
      if (details.title) detailParts.push(`"${details.title}"`);
      if (details.reason) detailParts.push(`lý do: ${details.reason}`);
      if (details.checksum) detailParts.push(`checksum: ${details.checksum.slice(0, 8)}...`);
    }
    const detailStr = detailParts.length ? ' | ' + detailParts.join(', ') : '';
    const line = `[${timeStr}] ${userName || 'system'} <${userEmail || 'system'}> | ${actionLabel} | ${entityLabel}${entityId ? ` #${entityId}` : ''}${detailStr}\n`;
    fs.appendFileSync(getLogPath(dateStr), line, 'utf8');
  } catch (e) {
    console.error('[LogService] Lỗi ghi audit log file:', e.message);
  }
}

function listLogFiles() {
  if (isMongoActive()) {
    return (async () => {
      try {
        const AuditLog = mongoose.model('AuditLog');
        const groups = await AuditLog.aggregate([
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              count: { $sum: 1 },
              lastModified: { $max: '$createdAt' }
            }
          },
          { $sort: { _id: -1 } }
        ]);
        return groups.map(g => ({
          filename: `${g._id}.log`,
          date: g._id,
          sizeKB: 'N/A',
          lines: g.count,
          created_at: g.lastModified,
          modified_at: g.lastModified,
        }));
      } catch (e) {
        return [];
      }
    })();
  }

  try {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
    return files.map(file => {
      const filePath = path.join(logsDir, file);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean).length;
      const dateStr = file.replace('.log', '');
      return {
        filename: file,
        date: dateStr,
        sizeKB: Math.round(stat.size / 102.4) / 10,
        lines: lines,
        created_at: stat.birthtime,
        modified_at: stat.mtime
      };
    }).sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) {
    return [];
  }
}

function readLogFile(date) {
  if (isMongoActive()) {
    return (async () => {
      try {
        const AuditLog = mongoose.model('AuditLog');
        const start = new Date(date + 'T00:00:00.000+07:00');
        const end = new Date(date + 'T23:59:59.999+07:00');
        const logs = await AuditLog.find({ createdAt: { $gte: start, $lte: end } })
          .sort({ createdAt: 1 })
          .lean();
        if (!logs.length) return null;
        return logs.map(l => {
          const time = l.createdAt ? l.createdAt.toISOString().slice(11, 19) : '00:00:00';
          const actionLabel = ACTION_LABELS[l.action] || l.action;
          const entityLabel = ENTITY_LABELS[l.entityType] || l.entityType;
          let details = '';
          try {
            const d = JSON.parse(l.details || '{}');
            const parts = [];
            if (d.title) parts.push(`"${d.title}"`);
            if (d.code) parts.push(`mã: ${d.code}`);
            if (d.original_name) parts.push(`file: ${d.original_name}`);
            if (parts.length) details = ' | ' + parts.join(', ');
          } catch {}
          return `[${time}] ${actionLabel} | ${entityLabel}${l.entityId ? ` #${l.entityId}` : ''}${details}`;
        }).join('\n');
      } catch (e) {
        return null;
      }
    })();
  }

  try {
    const logPath = getLogPath(date);
    if (!fs.existsSync(logPath)) return null;
    return fs.readFileSync(logPath, 'utf8');
  } catch (e) {
    return null;
  }
}

function readLogRange(fromDate, toDate) {
  if (isMongoActive()) {
    return (async () => {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      const parts = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const content = await readLogFile(dateStr);
        if (content && content.trim()) {
          parts.push(`=== ${dateStr} ===\n${content}`);
        }
      }
      return parts.join('\n') || '(Không có log trong khoảng thời gian này)';
    })();
  }

  try {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const parts = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const content = readLogFile(dateStr);
      if (content && content.trim()) {
        parts.push(`=== ${dateStr} ===\n${content}`);
      }
    }
    return parts.join('\n') || '(Không có log trong khoảng thời gian này)';
  } catch (e) {
    return '(Lỗi đọc log)';
  }
}

function searchLog(date, keyword) {
  if (isMongoActive()) {
    return (async () => {
      const content = await readLogFile(date);
      if (!content) return [];
      const lines = content.split('\n').filter(Boolean);
      if (!keyword) return lines;
      const kw = keyword.toLowerCase();
      return lines.filter(l => l.toLowerCase().includes(kw));
    })();
  }

  try {
    const content = readLogFile(date);
    if (!content) return [];
    const lines = content.split('\n').filter(Boolean);
    if (!keyword) return lines;
    const kw = keyword.toLowerCase();
    return lines.filter(l => l.toLowerCase().includes(kw));
  } catch (e) {
    return [];
  }
}

function backfillTodayLog() {
  // No-op
}

module.exports = {
  writeLog,
  listLogFiles,
  readLogFile,
  readLogRange,
  searchLog,
  backfillTodayLog,
};
