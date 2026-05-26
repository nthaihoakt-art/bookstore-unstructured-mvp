const base=process.env.BASE||'http://localhost:4000';
async function req(path, opt={}) {
  opt.headers = {...(opt.headers||{}), Authorization:'Bearer '+global.token};
  if (opt.body && typeof opt.body !== 'string') { opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(opt.body); }
  const r = await fetch(base+path,opt); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t}
  if(!r.ok) throw new Error(`${path} failed ${t}`); return j;
}
(async()=>{
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@bookstore.local',password:'Admin123!'})});
  global.token=(await login.json()).token;
  const books=await req('/api/books');
  const book=books[0];
  const order=await req('/api/orders',{method:'POST',body:{discount:0,tax:0,items:[{book_id:book.id,quantity:1},{book_id:book.id,quantity:1}]}});
  console.log('multi-item order OK', order.order_code);
  await req('/api/orders/'+order.id+'/cancel',{method:'POST',body:{reason:'flow test cancel'}});
  console.log('order cancel restore OK', order.order_code);
  const slip=await req('/api/inventory/slips',{method:'POST',body:{type:'in',note:'flow test',items:[{book_id:book.id,quantity:2,unit_cost:1000},{book_id:book.id,quantity:1,unit_cost:1000}]}});
  console.log('inventory slip OK', slip.slip_code);
  await req('/api/inventory/slips/'+slip.id);
  await req('/api/inventory/slips/'+slip.id+'/cancel',{method:'POST',body:{reason:'flow test reverse'}});
  console.log('inventory slip cancel reverse OK', slip.slip_code);
  await req('/api/users');
  const report=await fetch(base+'/api/reports/export/books',{headers:{Authorization:'Bearer '+global.token}});
  if(!report.ok) throw new Error('report failed '+await report.text());
  console.log('export OK', (await report.text()).slice(0,20));
  console.log('MVP_FLOW_OK');
})().catch(e=>{console.error(e);process.exit(1)});


