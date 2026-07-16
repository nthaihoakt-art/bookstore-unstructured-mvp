const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'bookstore.db'));

try {
  const badNames = ['VÄƒn há»\x8Dc', 'gn7766', 'rvrvr'];
  const stmt = db.prepare('DELETE FROM categories WHERE name = ?');
  let deletedCount = 0;
  for (const name of badNames) {
    const info = stmt.run(name);
    deletedCount += info.changes;
  }
  console.log(`Successfully deleted ${deletedCount} bad categories.`);
} catch (e) {
  console.error('Error during cleanup:', e);
}
db.close();
