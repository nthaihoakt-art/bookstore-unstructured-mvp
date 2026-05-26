const { spawn } = require('child_process');
const base=process.env.BASE||'http://localhost:4100';
const accounts=[
 ['admin@bookstore.local','Admin123!'],['manager@bookstore.local','Manager123!'],['sales@bookstore.local','Sales123!'],['warehouse@bookstore.local','Warehouse123!'],['accountant@bookstore.local','Accountant123!'],['documents@bookstore.local','Documents123!']
];
async function login(email,password){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})}); const j=await r.json(); if(!r.ok) throw new Error(email+' login '+JSON.stringify(j)); return j;}
async function status(token,path,opt={}){opt.headers={...(opt.headers||{}),Authorization:'Bearer '+token}; if(opt.body){opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(opt.body)} return fetch(base+path,opt).then(r=>r.status);}
async function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
async function waitForServer(){for(let i=0;i<40;i++){try{const r=await fetch(base+'/'); if(r.ok) return;}catch{} await sleep(250);} throw new Error('server not ready '+base);}
(async()=>{
 let child; if(!process.env.BASE){child=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:'4100'},stdio:['ignore','pipe','pipe']}); child.stderr.on('data',d=>process.stderr.write(d)); await waitForServer();}
 try{
   for(const [email,pw] of accounts){const {token,user}=await login(email,pw); console.log(user.role,user.permissions.length,'perms'); const dash=await status(token,'/api/dashboard'); if(dash!==200) throw new Error(user.role+' dashboard '+dash);}
   const sales=(await login('sales@bookstore.local','Sales123!')).token;
   console.log('sales users', await status(sales,'/api/users'));
   console.log('sales inventory create', await status(sales,'/api/inventory/transactions',{method:'POST',body:{book_id:1,type:'in',quantity:1,unit_cost:1}}));
   const wh=(await login('warehouse@bookstore.local','Warehouse123!')).token;
   console.log('warehouse customers', await status(wh,'/api/customers'));
   console.log('warehouse order create', await status(wh,'/api/orders',{method:'POST',body:{items:[]}}));
   const doc=(await login('documents@bookstore.local','Documents123!')).token;
   console.log('document inventory', await status(doc,'/api/inventory'));
   console.log('RBAC_TEST_OK');
 } finally { if(child) child.kill(); }
})().catch(e=>{console.error(e);process.exit(1)});

