'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// scripts/setup-mongo-feedback.js
// Seed dữ liệu mẫu cho collection feedbacks & bookRecommendations
// Schema đồng bộ với server_mongo.js
// Chạy: node scripts/setup-mongo-feedback.js
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bookstore_migrated';

// ── Schemas (đồng bộ với server_mongo.js) ────────────────────────────────────
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
    fileData: Buffer,
  }],
  sentiment: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
  score: { type: Number, default: 0.5 },
  isFeatured: { type: Boolean, default: false },
  status: { type: String, enum: ['new', 'reviewed', 'resolved', 'urgent'], default: 'new' },
  createdAt: { type: Date, default: Date.now },
});
feedbackSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 24 * 60 * 60 });
feedbackSchema.index({ bookId: 1, createdAt: -1 });
feedbackSchema.index({ sentiment: 1, rating: -1 });
feedbackSchema.index({ isFeatured: -1, createdAt: -1 });
const Feedback = mongoose.model('Feedback', feedbackSchema);

const bookRecommendationSchema = new mongoose.Schema({
  bookId: { type: Number, required: true, unique: true },
  bookTitle: String,
  similarBooks: [{
    bookId: Number,
    bookTitle: String,
    score: Number,
    reason: String,
  }],
  frequentlyBoughtTogether: [Number],
  updatedAt: { type: Date, default: Date.now },
});
bookRecommendationSchema.index({ updatedAt: -1 });
const BookRecommendation = mongoose.model('BookRecommendation', bookRecommendationSchema);

// ── Seed Data ─────────────────────────────────────────────────────────────────
let nextId = 1;
function nextFeedbackId() { return nextId++; }

const feedbackSeedData = [
  {
    _id: nextFeedbackId(), bookId: 1, bookTitle: 'Mắt biếc',
    customerId: 1, customerName: 'Trần Thị Mai', email: 'mai@gmail.com',
    rating: 5,
    comment: 'Đọc xong mà rưng rưng nước mắt. Văn phong Nguyễn Nhật Ánh trong sáng, gần gũi. Giao hàng nhanh, đóng gói cẩn thận.',
    tags: ['hay', 'cảm động', 'đóng gói tốt', 'giao nhanh'],
    sentiment: 'positive', score: 0.94, isFeatured: true, status: 'reviewed', helpful: 24,
  },
  {
    _id: nextFeedbackId(), bookId: 1, bookTitle: 'Mắt biếc',
    customerId: 2, customerName: 'Lê Văn Bình', email: 'binh@yahoo.com',
    rating: 4,
    comment: 'Sách in đẹp, giấy tốt. Nội dung không cần phải bàn. Chỉ hơi chậm giao hàng hơn dự kiến một ngày.',
    tags: ['in đẹp', 'giấy tốt'],
    sentiment: 'positive', score: 0.78, isFeatured: false, status: 'reviewed', helpful: 10,
  },
  {
    _id: nextFeedbackId(), bookId: 1, bookTitle: 'Mắt biếc',
    customerId: null, customerName: 'Khách vãng lai', email: 'guest@test.com',
    rating: 2,
    comment: 'Nội dung sách hay nhưng bìa sách bị trầy xước khi nhận. Cần đóng gói tốt hơn.',
    tags: ['bìa xấu', 'đóng gói kém'],
    sentiment: 'negative', score: 0.72, isFeatured: false, status: 'reviewed', helpful: 5,
  },
  {
    _id: nextFeedbackId(), bookId: 2, bookTitle: 'Đắc Nhân Tâm',
    customerId: 3, customerName: 'Nguyễn Thị Hương', email: 'huong@gmail.com',
    rating: 5,
    comment: 'Đọc rồi mà vẫn muốn đọc lại. Kinh điển không lỗi thời. Bản dịch tiếng Việt rất mượt mà, dễ hiểu.',
    tags: ['kinh điển', 'bản dịch tốt', 'nên đọc'],
    sentiment: 'positive', score: 0.97, isFeatured: true, status: 'reviewed', helpful: 45,
  },
  {
    _id: nextFeedbackId(), bookId: 2, bookTitle: 'Đắc Nhân Tâm',
    customerId: 4, customerName: 'Phạm Minh Tuấn', email: 'tuan@gmail.com',
    rating: 3,
    comment: 'Một số bài học trong sách hơi lỗi thời với bối cảnh hiện tại. Nhưng vẫn có nhiều điểm hay.',
    tags: ['bình thường'],
    sentiment: 'neutral', score: 0.52, isFeatured: false, status: 'reviewed', helpful: 8,
  },
  {
    _id: nextFeedbackId(), bookId: 3, bookTitle: 'Tôi thấy hoa vàng trên cỏ xanh',
    customerId: 5, customerName: 'Đỗ Thị Lan', email: 'lan@gmail.com',
    rating: 5,
    comment: 'Đọc cuốn này nhớ lại tuổi thơ quá. Mua tặng cho con gái, cháu thích lắm. Sách mới tinh, in rõ nét.',
    tags: ['tặng quà', 'tuổi thơ', 'phù hợp trẻ em'],
    sentiment: 'positive', score: 0.91, isFeatured: true, status: 'reviewed', helpful: 18,
  },
];

const recommendationSeedData = [
  {
    bookId: 1, bookTitle: 'Mắt biếc',
    similarBooks: [
      { bookId: 3, bookTitle: 'Tôi thấy hoa vàng trên cỏ xanh', score: 0.95, reason: 'Cùng tác giả Nguyễn Nhật Ánh' },
      { bookId: 4, bookTitle: 'Dế Mèn Phiêu Lưu Ký', score: 0.72, reason: 'Cùng thể loại Văn học thiếu nhi Việt Nam' },
    ],
    frequentlyBoughtTogether: [3, 2, 5],
  },
  {
    bookId: 2, bookTitle: 'Đắc Nhân Tâm',
    similarBooks: [
      { bookId: 6, bookTitle: 'Tư Duy Nhanh Và Chậm', score: 0.88, reason: 'Cùng thể loại Kỹ năng sống' },
      { bookId: 7, bookTitle: '7 Thói Quen Của Người Thành Đạt', score: 0.85, reason: 'Cùng thể loại Self-help' },
    ],
    frequentlyBoughtTogether: [6, 7],
  },
  {
    bookId: 3, bookTitle: 'Tôi thấy hoa vàng trên cỏ xanh',
    similarBooks: [
      { bookId: 1, bookTitle: 'Mắt biếc', score: 0.95, reason: 'Cùng tác giả Nguyễn Nhật Ánh' },
      { bookId: 4, bookTitle: 'Dế Mèn Phiêu Lưu Ký', score: 0.78, reason: 'Cùng thể loại Văn học thiếu nhi' },
    ],
    frequentlyBoughtTogether: [1, 4],
  },
];

async function main() {
  console.log('\n🚀 Bắt đầu seed MongoDB Feedback & Recommendations...\n');

  await mongoose.connect(MONGO_URI);
  console.log('✅ Kết nối MongoDB thành công');

  // Xóa dữ liệu cũ
  await Feedback.deleteMany({});
  await BookRecommendation.deleteMany({});
  console.log('🗑️  Đã xóa dữ liệu cũ\n');

  // Seed Feedbacks
  console.log('💬 [1/2] Seed collection: feedbacks...');
  const feedbacks = await Feedback.insertMany(feedbackSeedData);
  console.log(`   ✓ Đã tạo ${feedbacks.length} feedback documents`);

  // Thống kê sentiment
  const stats = await Feedback.aggregate([
    { $group: { _id: '$sentiment', count: { $sum: 1 }, avgRating: { $avg: '$rating' } } }
  ]);
  console.log('   📊 Phân bố sentiment:');
  for (const s of stats) {
    console.log(`      ${s._id}: ${s.count} đánh giá, avg rating: ${s.avgRating.toFixed(1)}`);
  }

  // Seed Recommendations
  console.log('\n📚 [2/2] Seed collection: bookrecommendations...');
  const recs = await BookRecommendation.insertMany(recommendationSeedData);
  console.log(`   ✓ Đã tạo ${recs.length} recommendation documents`);

  // Tổng kết
  const totalFeedback = await Feedback.countDocuments();
  const totalRec = await BookRecommendation.countDocuments();
  console.log('\n─────────────────────────────────────────────');
  console.log('✅ SEED MONGODB HOÀN TẤT');
  console.log(`   feedbacks:           ${totalFeedback} documents`);
  console.log(`   bookrecommendations: ${totalRec} documents`);
  console.log('─────────────────────────────────────────────\n');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Lỗi:', err.message);
  process.exit(1);
});
