import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  // Se Railway fornisce DATABASE_URL lo usa, altrimenti usa i parametri singoli
  connectionString: process.env.DATABASE_URL || `postgres://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`,
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
