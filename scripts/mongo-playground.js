require('dotenv').config();
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch (e) {}

const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://nnp1426_db_user:SjipRoD5Q4CDpEiU@cluster0.1ovaxuk.mongodb.net/bookstore_migrated?appName=Cluster0';

console.log("=== MONGO PLAYGROUND ===");
const queryStr = process.argv[2];
if (!queryStr) {
  console.log("Cách dùng: node scripts/mongo-playground.js \"CÂU_TRUY_VẤN_MONGO\"");
  console.log("Ví dụ:");
  console.log("  node scripts/mongo-playground.js \"Book.find({}).limit(2)\"");
  console.log("  node scripts/mongo-playground.js \"Order.find({}).select('orderCode total items')\"");
  process.exit(0);
}

const genericSchema = new mongoose.Schema({}, { strict: false });
const Book = mongoose.model('Book', genericSchema, 'books');
const Order = mongoose.model('Order', genericSchema, 'orders');

mongoose.connect(MONGO_URI)
  .then(async () => {
    try {
      const fn = new Function('Book', 'Order', `return ${queryStr};`);
      const result = await fn(Book, Order);
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error("Lỗi truy vấn:", e.message);
    } finally {
      mongoose.connection.close();
    }
  })
  .catch(err => {
    console.error("Lỗi kết nối MongoDB:", err.message);
  });
