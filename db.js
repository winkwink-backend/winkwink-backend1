import pkg from 'pg';
const { Pool, types } = pkg;
import dotenv from 'dotenv';
dotenv.config();

// 🔥 FIX: forza pg a convertire BIGINT → int
types.setTypeParser(20, val => parseInt(val, 10));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL 
    || `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error("❌ Errore critico DB:", err);
  } else {
    console.log("✅ Database connesso correttamente su Railway");
  }
});

export default pool;
