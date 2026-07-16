'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// scripts/setup-mongo-feedback.js
// Seed dữ liệu mẫu cho collection feedbacks & bookRecommendations
// Chạy: node scripts/setup-mongo-feedback.js
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bookstore_migrated';

// ── Schemas ──────────────────────────────────────────────────────────────────
const feedbackSchema = new mongoose.Schema({
  bookId: Number,
  bookTitle: String,
  customerId: { type: Number, default: null },
  customerName: { type: String, required: true },
  customerEmail: String,
  rating: { type: Number, min: 1, max: 5, required: true },
  title: String,
  content: { type: String, required: true },
  images: [{ filename: String, caption: String }],
  tags: [String],
  sentiment: { type: String, enum: ['positive', 'negative', 'neutral'], default: 'neutral' },
  sentimentScore: { type: Number, default: 0.5 },
  isFeatured: { type: Boolean, default: false },
  isVerifiedPurchase: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  helpful: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
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
bookRecommendationSchema.index({ bookId: 1 });
const BookRecommendation = mongoose.model('BookRecommendation', bookRecommendationSchema);

// ── Seed Data ─────────────────────────────────────────────────────────────────
const feedbackSeedData = [
  {
    bookId: 1, bookTitle: 'Mắt biếc',
    customerId: 1, customerName: 'Trần Thị Mai', customerEmail: 'mai@gmail.com',
    rating: 5, title: 'Sách hay, cảm động lắm!',
    content: 'Đọc xong mà rưng rưng nước mắt. Văn phong Nguyễn Nhật Ánh trong sáng, gần gũi. Giao hàng nhanh, đóng gói cẩn thận.',
    tags: ['hay', 'cảm động', 'đóng gói tốt', 'giao nhanh'],
    sentiment: 'positive', sentimentScore: 0.94, isFeatured: true, isVerifiedPurchase: true, status: 'approved', helpful: 24,
  },
  {
    bookId: 1, bookTitle: 'Mắt biếc',
    customerId: 2, customerName: 'Lê Văn Bình', customerEmail: 'binh@yahoo.com',
    rating: 4, title: 'Đúng như mong đợi',
    content: 'Sách in đẹp, giấy tốt. Nội dung không cần phải bàn. Chỉ hơi chậm giao hàng hơn dự kiến một ngày.',
    tags: ['in đẹp', 'giấy tốt'],
    sentiment: 'positive', sentimentScore: 0.78, isFeatured: false, isVerifiedPurchase: true, status: 'approved', helpful: 10,
  },
  {
    bookId: 1, bookTitle: 'Mắt biếc',
    customerId: null, customerName: 'Khách vãng lai', customerEmail: 'guest@test.com',
    rating: 2, title: 'Bìa sách bị trầy',
    content: 'Nội dung sách hay nhưng bìa sách bị trầy xước khi nhận. Cần đóng gói tốt hơn.',
    tags: ['bìa xấu', 'đóng gói kém'],
    sentiment: 'negative', sentimentScore: 0.72, isFeatured: false, isVerifiedPurchase: false, status: 'approved', helpful: 5,
  },
  {
    bookId: 2, bookTitle: 'Đắc Nhân Tâm',
    customerId: 3, customerName: 'Nguyễn Thị Hương', customerEmail: 'huong@gmail.com',
    rating: 5, title: 'Cuốn sách thay đổi cuộc đời',
    content: 'Đọc rồi mà vẫn muốn đọc lại. Kinh điển không lỗi thời. Bản dịch tiếng Việt rất mượt mà, dễ hiểu.',
    tags: ['kinh điển', 'bản dịch tốt', 'nên đọc'],
    sentiment: 'positive', sentimentScore: 0.97, isFeatured: true, isVerifiedPurchase: true, status: 'approved', helpful: 45,
  },
  {
    bookId: 2, bookTitle: 'Đắc Nhân Tâm',
    customerId: 4, customerName: 'Phạm Minh Tuấn', customerEmail: 'tuan@gmail.com',
    rating: 3, title: 'Bình thường, không như kỳ vọng',
    content: 'Một số bài học trong sách hơi lỗi thời với bối cảnh hiện tại. Nhưng vẫn có nhiều điểm hay.',
    tags: ['bình thường'],
    sentiment: 'neutral', sentimentScore: 0.52, isFeatured: false, isVerifiedPurchase: true, status: 'approved', helpful: 8,
  },
  {
    bookId: 3, bookTitle: 'Tôi thấy hoa vàng trên cỏ xanh',
    customerId: 5, customerName: 'Đỗ Thị Lan', customerEmail: 'lan@gmail.com',
    rating: 5, title: 'Tuổi thơ ùa về!',
    content: 'Đọc cuốn này nhớ lại tuổi thơ quá. Mua tặng cho con gái, cháu thích lắm. Sách mới tinh, in rõ nét.',
    tags: ['tặng quà', 'tuổi thơ', 'phù hợp trẻ em'],
    sentiment: 'positive', sentimentScore: 0.91, isFeatured: true, isVerifiedPurchase: true, status: 'approved', helpful: 18,
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
