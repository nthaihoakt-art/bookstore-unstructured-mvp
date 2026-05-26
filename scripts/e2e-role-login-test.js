const assert = require('assert');
const { spawn } = require('child_process');

const BASE = process.env.BASE || 'http://localhost:4100';
const accounts = [
  ['admin@bookstore.local','Admin123!','admin'],
  ['manager@bookstore.local','Manager123!','manager'],
  ['sales@bookstore.local','Sales123!','sales'],
  ['warehouse@bookstore.local','Warehouse123!','warehouse'],
  ['accountant@bookstore.local','Accountant123!','accountant'],
  ['documents@bookstore.local','Documents123!','document_staff'],
];

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function waitForServer(){
  for(let i=0;i<40;i++){
    try { const r = await fetch(BASE + '/'); if (r.ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('Server did not start: ' + BASE);
}
async function login(email,password){
  const r = await fetch(BASE + '/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const j = await r.json().catch(()=>({}));
  assert.strictEqual(r.status, 200, email + ' login failed: ' + JSON.stringify(j));
  assert.ok(j.token, email + ' missing token');
  assert.ok(Array.isArray(j.user.permissions), email + ' missing permissions');
  return j;
}
async function api(path,token){
  const r = await fetch(BASE + path,{headers:{Authorization:'Bearer '+token}});
  return {status:r.status, body:await r.json().catch(()=>({}))};
}
async function run(){
  let child;
  if(!process.env.BASE){
    child = spawn(process.execPath, ['src/server.js'], { cwd: process.cwd(), env:{...process.env, PORT:'4100'}, stdio:['ignore','pipe','pipe'] });
    child.stderr.on('data', d => process.stderr.write(d));
    await waitForServer();
  }
  try{
    const seen = {};
    for(const [email,password,role] of accounts){
      const session = await login(email,password);
      assert.strictEqual(session.user.role, role, email + ' wrong role');
      seen[role] = session.user.permissions.length;
      const dashboard = await api('/api/dashboard', session.token);
      assert.strictEqual(dashboard.status, 200, role + ' dashboard denied');
    }
    const sales = await login('sales@bookstore.local','Sales123!');
    const usersDenied = await api('/api/users', sales.token);
    assert.strictEqual(usersDenied.status, 403, 'sales must not access users');
    console.log('E2E_ROLE_LOGIN_OK', seen);
  } finally {
    if(child) child.kill();
  }
}
run().catch(e=>{ console.error(e); process.exit(1); });

