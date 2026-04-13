import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false   // IMPORTANTISSIMO per il tuo caso
});

async function test() {
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("DB OK:", res.rows);
  } catch (err) {
    console.error("DB ERROR:", err);
  }
}

test();