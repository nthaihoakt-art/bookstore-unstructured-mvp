const fs = require('fs');
const path = require('path');
const base=process.env.BASE||'http://localhost:4000';
async function login(){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@bookstore.local',password:'Admin123!'})});const j=await r.json();if(!r.ok)throw new Error(j.error);return j.token;}
async function api(token,path,opt={}){opt.headers={...(opt.headers||{}),Authorization:'Bearer '+token};if(opt.body&&!(opt.body instanceof FormData)){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(opt.body)}const r=await fetch(base+path,opt);const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}if(!r.ok)throw new Error(`${path} failed ${t}`);return j;}
(async()=>{
  const token=await login();
  const p=path.join(__dirname,'tmp-upload-test.txt');
  fs.writeFileSync(p,'Xin chÃ o bookstore OCR/search text preview test');
  const fd=new FormData();
  fd.append('file', new Blob([fs.readFileSync(p)], {type:'text/plain'}), 'tmp-upload-test.txt');
  fd.append('doc_type','internal');
  fd.append('title','Hardening text preview test');
  const doc=await api(token,'/api/documents',{method:'POST',body:fd});
  console.log('secure upload OK', doc.id, doc.checksum ? 'checksum' : 'no-checksum');
  const text=await fetch(base+'/api/documents/'+doc.id+'/text',{headers:{Authorization:'Bearer '+token}}).then(r=>r.text());
  if(!text.includes('bookstore OCR')) throw new Error('text preview missing extracted text');
  console.log('text preview OK');
  const roles=await api(token,'/api/roles');
  const perms=await api(token,'/api/permissions');
  if(!roles[0].permissions || !perms.length) throw new Error('permissions missing');
  await api(token,'/api/roles/'+roles[0].id+'/permissions',{method:'PUT',body:{permission_ids:roles[0].permissions.map(p=>p.id)}});
  console.log('permission matrix API OK');
  await api(token,'/api/documents/'+doc.id,{method:'DELETE'});
  fs.unlinkSync(p);
  console.log('HARDENING_OK');
})().catch(e=>{console.error(e);process.exit(1)});


