const express = require('express');
const path = require('path');
const db = require('./base');
const app = express();
const { randomBytes, scryptSync, timingSafeEqual } = require('crypto');
const sesiones = new Map();
const duracion = 8*60*60*1000;
app.use(express.json({limit:'256kb'}));
app.use('/vendor/bootstrap', express.static(path.join(__dirname,'node_modules/bootstrap/dist')));
app.use('/vendor/bootstrap-icons', express.static(path.join(__dirname,'node_modules/bootstrap-icons/font')));
// Credenciales comprobadas en el servidor; sesión en cookie HttpOnly.
app.use((req,res,next)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method==='POST' && req.headers.origin && req.headers.origin!==`http://${req.headers.host}`) return res.status(403).json({error:'Origen no permitido.'});
 next();
});
const token = req => (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('pos_sesion='))?.slice(11);
app.post('/api/login',async(req,res,next)=>{
 try{
  const b=req.body||{};
  if(typeof b.usuario!=='string'||typeof b.contrasena!=='string'||b.usuario.length>60||b.contrasena.length>255) return res.status(401).json({error:'Usuario o contraseña incorrectos.'});
  const u=await db.exclusive(async()=> (await db.query('SELECT id_usuario,hash_contrasena FROM usuario WHERE nombre_usuario=$1',[b.usuario])).rows[0]);
  const partes=u?.hash_contrasena.split(':')||[];
  if(partes.length!==3||partes[0]!=='scrypt') return res.status(401).json({error:'Usuario o contraseña incorrectos.'});
  const actual=scryptSync(b.contrasena,partes[1],32),esperado=Buffer.from(partes[2],'hex');
  if(esperado.length!==actual.length||!timingSafeEqual(actual,esperado)) return res.status(401).json({error:'Usuario o contraseña incorrectos.'});
  const anterior=token(req);if(anterior)sesiones.delete(anterior);
  const id=randomBytes(32).toString('hex');sesiones.set(id,{id_usuario:u.id_usuario,vence:Date.now()+duracion});
  res.setHeader('Set-Cookie',`pos_sesion=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${duracion/1000}`);
  res.json({ok:true});
 }catch(e){next(e);}
});
app.use((req,res,next)=>{
 for(const [id,s] of sesiones)if(s.vence<=Date.now())sesiones.delete(id);
 const sesion=sesiones.get(token(req));
 if(sesion){req.usuario=sesion;return next();}
 if(['/login.html','/estilo.css'].includes(req.path))return next();
 if(req.path.startsWith('/api/'))return res.status(401).json({error:'Inicia sesión para continuar.'});
 return res.redirect('/login.html');
});
app.post('/api/logout',(req,res)=>{
 sesiones.delete(token(req));res.setHeader('Set-Cookie','pos_sesion=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true});
});
app.use(express.static(path.join(__dirname,'public')));
const error400 = message => Object.assign(new Error(message),{status:400});
const ruta = (method,url,fn) => app[method](url,async(req,res,next)=>{
  try { await db.exclusive(()=>fn(req,res)); } catch(e) { next(e); }
});
ruta('get','/api/catalogo',async(req,res)=>res.json((await db.query('SELECT * FROM vista_catalogo_prendas ORDER BY id_variante')).rows));
ruta('get','/api/opciones',async(req,res)=>res.json({
  clientes:(await db.query('SELECT * FROM cliente ORDER BY nombre')).rows,
  metodos:(await db.query('SELECT * FROM metodo_pago ORDER BY id_metodo_pago')).rows
}));
ruta('get','/api/ventas',async(req,res)=>res.json((await db.query(`SELECT v.*,c.nombre AS cliente,f.folio FROM vista_venta_total v LEFT JOIN cliente c USING(id_cliente) LEFT JOIN factura f USING(id_venta) ORDER BY v.id_venta DESC LIMIT 50`)).rows));
ruta('get','/api/ventas/:id',async(req,res)=>{
  if (!/^\d+$/.test(req.params.id)) throw error400('Folio inválido.');
  const venta=(await db.query(`SELECT v.*,f.folio,c.nombre AS cliente FROM vista_venta_total v LEFT JOIN factura f USING(id_venta) LEFT JOIN cliente c USING(id_cliente) WHERE v.id_venta=$1`,[req.params.id])).rows[0];
  if (!venta) return res.status(404).json({error:'Venta no encontrada.'});
  venta.detalles=(await db.query(`SELECT d.*,p.nombre,v.talla,v.color FROM detalle_venta d JOIN variante_producto v USING(id_variante) JOIN producto p USING(id_producto) WHERE id_venta=$1`,[req.params.id])).rows;
  res.json(venta);
});
ruta('post','/api/ventas',async(req,res)=>{
  const b=req.body;
  if (!b || !Array.isArray(b.items) || b.items.length===0 || b.items.length>100) throw error400('Agrega de 1 a 100 variantes.');
  if (!/^\d+$/.test(String(b.id_metodo_pago))) throw error400('Selecciona un método de pago.');
  const ids=new Set();
  for(const item of b.items) {
    if (!/^\d+$/.test(String(item.id_variante)) || !Number.isSafeInteger(item.cantidad) || item.cantidad<1 || item.cantidad>10000 || ids.has(String(item.id_variante))) throw error400('Revisa las cantidades y evita variantes repetidas.');
    ids.add(String(item.id_variante));
  }
  await db.query('BEGIN');
  try {
    if (!(await db.query('SELECT 1 FROM metodo_pago WHERE id_metodo_pago=$1',[b.id_metodo_pago])).rows.length) throw error400('Método de pago inválido.');
    if (b.id_cliente && (!/^\d+$/.test(String(b.id_cliente)) || !(await db.query('SELECT 1 FROM cliente WHERE id_cliente=$1',[b.id_cliente])).rows.length)) throw error400('Cliente inválido.');
    const usuario=req.usuario;
    const v=(await db.query('INSERT INTO venta(id_cliente,id_usuario) VALUES($1,$2) RETURNING id_venta',[b.id_cliente||null,usuario.id_usuario])).rows[0];
    let total=0;
    // Orden estable para evitar bloqueos cruzados al vender varias variantes.
    for(const item of [...b.items].sort((a,b)=>Number(a.id_variante)-Number(b.id_variante))) {
      const stock=await db.query('UPDATE inventario SET existencia=existencia-$1 WHERE id_variante=$2 AND existencia >= $1 RETURNING existencia',[item.cantidad,item.id_variante]);
      if (!stock.rows.length) throw error400('Una prenda no tiene existencias suficientes. Actualiza el catálogo.');
      const p=(await db.query('SELECT p.precio_venta FROM variante_producto v JOIN producto p USING(id_producto) WHERE id_variante=$1',[item.id_variante])).rows[0];
      await db.query('INSERT INTO detalle_venta(id_venta,id_variante,cantidad,precio_unitario) VALUES($1,$2,$3,$4)',[v.id_venta,item.id_variante,item.cantidad,p.precio_venta]);
      total+=Math.round(Number(p.precio_venta)*100)*item.cantidad;
    }
    await db.query('INSERT INTO pago(id_venta,id_metodo_pago,monto) VALUES($1,$2,$3)',[v.id_venta,b.id_metodo_pago,total/100]);
    const folio=`V-${String(v.id_venta).padStart(6,'0')}`;
    await db.query('INSERT INTO factura(id_venta,folio) VALUES($1,$2)',[v.id_venta,folio]);
    await db.query('COMMIT');
    res.status(201).json({id_venta:v.id_venta,folio,total:total/100});
  } catch(e) { await db.query('ROLLBACK'); throw e; }
});
ruta('post','/api/cuestionarios',async(req,res)=>{
  const b=req.body;
  if(!b || typeof b.nombre_comercial!=='string' || !b.nombre_comercial.trim() || b.nombre_comercial.length>120 || typeof b.telefono!=='string' || b.telefono.length>25 || typeof b.correo!=='string' || b.correo.length>190 || !Array.isArray(b.productos) || !b.productos.length || b.productos.length>100) throw error400('Revisa los datos del proveedor.');
  for(const p of b.productos) if(!p || typeof p.nombre!=='string' || !p.nombre.trim() || !Number.isFinite(Number(p.precio_unitario)) || Number(p.precio_unitario)<0) throw error400('Revisa los nombres y precios de los productos.');
  await db.query('BEGIN');
  try {
    const proveedor=(await db.query('INSERT INTO proveedor(nombre,telefono,correo) VALUES($1,$2,$3) RETURNING id_proveedor',[b.nombre_comercial.trim(),b.telefono,b.correo])).rows[0];
    const q=(await db.query('INSERT INTO cuestionario_proveedor(id_proveedor,respuestas) VALUES($1,$2::jsonb) RETURNING id_cuestionario',[proveedor.id_proveedor,JSON.stringify(b)])).rows[0];
    await db.query('COMMIT');res.status(201).json(q);
  }catch(e){await db.query('ROLLBACK');throw e;}
});
ruta('get','/api/proveedores',async(req,res)=>res.json((await db.query('SELECT p.*,q.id_cuestionario,q.fecha FROM proveedor p LEFT JOIN cuestionario_proveedor q USING(id_proveedor) ORDER BY p.id_proveedor DESC')).rows));
app.use((e,req,res,next)=>{ console.error(e.message);res.status(e.status||500).json({error:e.status?e.message:'No se pudo completar la operación.'}); });
db.iniciar().then(async()=>{
 const sal=randomBytes(16).toString('hex');
 const hash='scrypt:'+sal+':'+scryptSync('x',sal,32).toString('hex');
 await db.query("INSERT INTO usuario(nombre,nombre_usuario,hash_contrasena) VALUES($1,$2,$3) ON CONFLICT(nombre_usuario) DO NOTHING",['Usuario de prueba','x',hash]);
}).then(()=>app.listen(process.env.PORT||3000,'127.0.0.1',()=>console.log(`POS listo: http://localhost:${process.env.PORT||3000} — ${process.env.DB_MODE==='postgres'?'PostgreSQL externo':'PostgreSQL integrado de prueba'}`))).catch(e=>{console.error('No se pudo iniciar:',e.message);process.exit(1);});
