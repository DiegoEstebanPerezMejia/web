const {spawn}=require('child_process');const fs=require('fs');const os=require('os');const path=require('path');const assert=require('assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pos-test-'));
const server=spawn(process.execPath,['servidor.js'],{cwd:__dirname,env:{...process.env,DB_MODE:'demo',PORT:'3137',DEMO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
server.stderr.on('data',()=>{});
let cookie='';
async function req(url,body){const r=await fetch('http://127.0.0.1:3137'+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});const nueva=r.headers.get('set-cookie');if(nueva)cookie=nueva.split(';')[0];return {status:r.status,data:await r.json()};}
(async()=>{try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Inicio agotado')),45000);server.stdout.on('data',s=>{if(String(s).includes('POS listo')){clearTimeout(t);resolve();}});server.on('exit',code=>{clearTimeout(t);reject(Error('Servidor terminó: '+code));});});
 assert.equal((await req('/api/catalogo')).status,401);
 const protegida=await fetch('http://127.0.0.1:3137/ventas.html',{redirect:'manual'});assert.equal(protegida.status,302);assert.equal(protegida.headers.get('location'),'/login.html');
 assert.equal((await req('/api/login',{usuario:'x',contrasena:'incorrecta'})).status,401);
 assert.equal((await req('/api/login',{usuario:'x',contrasena:'x'})).status,200);
 const cat=(await req('/api/catalogo')).data;assert.equal(cat.length,16);
 const opciones=(await req('/api/opciones')).data;const id=cat[0].id_variante;
 const venta=await req('/api/ventas',{id_metodo_pago:opciones.metodos[0].id_metodo_pago,items:[{id_variante:id,cantidad:2}]});assert.equal(venta.status,201);assert.equal(venta.data.total,Number(cat[0].precio_venta)*2);
 let nuevo=(await req('/api/catalogo')).data;assert.equal(nuevo[0].existencia,10);
 const ticket=(await req('/api/ventas/'+venta.data.id_venta)).data;assert.equal(ticket.detalles.length,1);assert.equal(ticket.detalles[0].cantidad,2);
 const fallo=await req('/api/ventas',{id_metodo_pago:opciones.metodos[0].id_metodo_pago,items:[{id_variante:id,cantidad:1},{id_variante:cat[1].id_variante,cantidad:999}]});assert.equal(fallo.status,400);nuevo=(await req('/api/catalogo')).data;assert.equal(nuevo[0].existencia,10);assert.equal((await req('/api/ventas')).data.length,1);
 const q=await req('/api/cuestionarios',{nombre_comercial:'Proveedor de prueba',telefono:'5500000000',correo:'prueba@example.com',productos:[{nombre:'Playera prueba',precio_unitario:'90',tallas:['M'],colores:['Negro']}]});assert.equal(q.status,201);assert.ok((await req('/api/proveedores')).data.some(p=>p.nombre==='Proveedor de prueba'&&p.id_cuestionario));
 for(const pagina of ['ventas.html','catalogo.html','proveedores.html'])assert.equal((await fetch('http://127.0.0.1:3137/'+pagina,{headers:{Cookie:cookie}})).status,200);
 for(const asset of ['/vendor/bootstrap/css/bootstrap.min.css','/vendor/bootstrap/js/bootstrap.bundle.min.js','/vendor/bootstrap-icons/bootstrap-icons.css']) assert.equal((await fetch('http://127.0.0.1:3137'+asset)).status,200);
 assert.equal((await req('/api/logout',{})).status,200);assert.equal((await req('/api/catalogo')).status,401);
 console.log('OK: acceso x/x, rechazo de contraseña incorrecta, rutas protegidas, cierre de sesión; datos iniciales, venta, ticket, descuento de stock, reversión completa por falta de stock, cuestionario y tres pantallas.');
 }catch(e){console.error(e);process.exitCode=1;}finally{server.kill();await new Promise(r=>server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}})();
