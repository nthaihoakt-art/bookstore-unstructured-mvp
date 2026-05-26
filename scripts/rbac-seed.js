const { db } = require('../src/db');
const bcrypt = require('bcryptjs');
const permissions = ['books.view','books.create','books.update','books.delete','customers.view','customers.view_all','customers.create','customers.update','customers.delete','orders.view','orders.view_all','orders.create','orders.update','orders.cancel','inventory.view','inventory.import','inventory.export','inventory.adjust','suppliers.view','suppliers.create','suppliers.update','suppliers.delete','documents.view','documents.view_all','documents.upload','documents.update','documents.delete','search.use','reports.view_basic','reports.view_financial','users.view','users.create','users.update','users.delete','roles.manage','audit_logs.view','settings.manage'];
const roleMatrix = {
  admin: permissions,
  manager: permissions.filter(p=>!['roles.manage','settings.manage','users.create','users.update','users.delete'].includes(p)).concat(['users.view']),
  sales: ['books.view','customers.view','customers.create','customers.update','orders.view','orders.create','orders.update','orders.cancel','documents.view','documents.upload','search.use','reports.view_basic'],
  warehouse: ['books.view','inventory.view','inventory.import','inventory.export','inventory.adjust','suppliers.view','suppliers.create','suppliers.update','documents.view','documents.upload','documents.update','search.use','reports.view_basic'],
  accountant: ['orders.view','orders.view_all','orders.update','documents.view','documents.view_all','documents.upload','documents.update','search.use','reports.view_basic','reports.view_financial','suppliers.view'],
  document_staff: ['books.view','orders.view','orders.view_all','suppliers.view','customers.view','customers.view_all','documents.view','documents.view_all','documents.upload','documents.update','documents.delete','search.use','reports.view_basic']
};
const roleLabels={admin:'Quản trị viên',manager:'Quản lý nhà sách',sales:'Nhân viên bán hàng',warehouse:'Nhân viên kho',accountant:'Kế toán',document_staff:'Nhân viên tài liệu'};
const tx=db.transaction(()=>{
  for(const [name,description] of Object.entries(roleLabels)) db.prepare('INSERT INTO roles(name,description) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET description=excluded.description').run(name,description);
  for(const code of permissions) db.prepare('INSERT INTO permissions(code,description) VALUES (?,?) ON CONFLICT(code) DO UPDATE SET description=excluded.description').run(code,code);
  for(const [role,codes] of Object.entries(roleMatrix)){
    const roleId=db.prepare('SELECT id FROM roles WHERE name=?').get(role).id;
    db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(roleId);
    const ins=db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_id) VALUES (?,(SELECT id FROM permissions WHERE code=?))');
    codes.forEach(code=>ins.run(roleId,code));
  }
  const users=[['Quản trị viên','admin@bookstore.local','Admin123!','admin'],['Quản lý nhà sách','manager@bookstore.local','Manager123!','manager'],['Nhân viên bán hàng','sales@bookstore.local','Sales123!','sales'],['Nhân viên kho','warehouse@bookstore.local','Warehouse123!','warehouse'],['Kế toán','accountant@bookstore.local','Accountant123!','accountant'],['Nhân viên tài liệu','documents@bookstore.local','Documents123!','document_staff']];
  for(const [full,email,pw,role] of users){const roleId=db.prepare('SELECT id FROM roles WHERE name=?').get(role).id; db.prepare('INSERT INTO users(full_name,email,password_hash,role_id,is_active) VALUES (?,?,?,?,1) ON CONFLICT(email) DO UPDATE SET full_name=excluded.full_name,password_hash=excluded.password_hash,role_id=excluded.role_id,is_active=1').run(full,email,bcrypt.hashSync(pw,10),roleId);}
});
tx();
for(const r of db.prepare('SELECT * FROM roles ORDER BY id').all()) console.log(r.name, db.prepare('SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id WHERE rp.role_id=? ORDER BY p.code').all(r.id).map(x=>x.code).join(', '));
