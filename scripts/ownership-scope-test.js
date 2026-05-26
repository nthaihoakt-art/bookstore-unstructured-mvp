const assert = require('assert');
const { spawn } = require('child_process');
const { db } = require('../src/db');
const BASE = process.env.BASE || 'http://localhost:4100';
async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function waitForServer(){for(let i=0;i<40;i++){try{const r=await fetch(BASE+'/'); if(r.ok) return;}catch{} await sleep(250);} throw new Error('server not ready '+BASE);}
async function login(email,password){const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}); const j=await r.json(); assert.strictEqual(r.status,200,email+' login'); return j;}
async function request(token,path,opt={}){opt.headers={...(opt.headers||{}),Authorization:'Bearer '+token}; if(opt.body && !(opt.body instanceof FormData)){opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(opt.body);} const r=await fetch(BASE+path,opt); return {status:r.status,body:await r.json().catch(()=>({}))};}
(async()=>{
 let child; if(!process.env.BASE){child=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'4100'},stdio:['ignore','pipe','pipe']}); child.stderr.on('data',d=>process.stderr.write(d)); await waitForServer();}
 try{
   const sales=await login('sales@bookstore.local','Sales123!');
   const admin=await login('admin@bookstore.local','Admin123!');
   const book=db.prepare('SELECT id FROM books WHERE stock_quantity > 1 LIMIT 1').get();
   assert.ok(book,'need seeded book');
   const create=await request(sales.token,'/api/orders',{method:'POST',body:{payment_method:'cash',items:[{book_id:book.id,quantity:1}]}});
   assert.strictEqual(create.status,201,'sales create own order');
   const ownId=create.body.id;
   const adminCreate=await request(admin.token,'/api/orders',{method:'POST',body:{payment_method:'cash',items:[{book_id:book.id,quantity:1}]}});
   assert.strictEqual(adminCreate.status,201,'admin create other order');
   const list=await request(sales.token,'/api/orders');
   assert.strictEqual(list.status,200,'sales list orders');
   assert.ok(list.body.some(o=>o.id===ownId),'sales sees own order');
   assert.ok(!list.body.some(o=>o.id===adminCreate.body.id),'sales must not see admin order');
   const detail=await request(sales.token,'/api/orders/'+adminCreate.body.id);
   assert.strictEqual(detail.status,403,'sales cannot read other order detail');
   const adminList=await request(admin.token,'/api/orders');
   assert.ok(adminList.body.some(o=>o.id===adminCreate.body.id),'admin sees all orders');
   console.log('OWNERSHIP_SCOPE_OK');
 } finally { if(child) child.kill(); }
})().catch(e=>{console.error(e);process.exit(1)});

