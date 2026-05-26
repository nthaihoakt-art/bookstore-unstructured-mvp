const base=process.env.BASE||'http://localhost:4000';
(async()=>{
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@bookstore.local',password:'Admin123!'})});
  if(!login.ok) throw new Error('login failed '+await login.text());
  const {token}=await login.json();
  const h={Authorization:'Bearer '+token};
  for (const path of ['/api/dashboard','/api/books','/api/search?q=Máº¯t']) {
    const r=await fetch(base+path,{headers:h});
    if(!r.ok) throw new Error(path+' failed '+await r.text());
    console.log(path, 'OK');
  }
  console.log('SMOKE_OK');
})().catch(e=>{console.error(e);process.exit(1)});


