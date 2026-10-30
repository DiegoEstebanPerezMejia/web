const fs = require('fs');
const path = require('path');
require('dotenv').config();
let driver;
let cola = Promise.resolve();
function exclusive(fn) {
  const result = cola.then(fn);
  cola = result.catch(() => {});
  return result;
}
async function iniciar() {
  if (process.env.DB_MODE === 'postgres') {
    const { Pool } = require('pg');
    const pool = new Pool();
    driver = await pool.connect();
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    driver = new PGlite(process.env.DEMO_DATA_DIR || path.join(__dirname,'datos'));
    await driver.waitReady;
  }
  for (const archivo of ['01_esquema.sql','02_cuestionario.sql','03_datos_demo.sql']) {
    const sql = fs.readFileSync(path.join(__dirname,archivo),'utf8');
    if (driver.exec) await driver.exec(sql); else await driver.query(sql);
  }
}
module.exports = { iniciar, exclusive, query: (sql,params=[]) => driver.query(sql,params) };
