import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());

// 🔥 Connessione a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ------------------------------------------------------------
// 1️⃣ LOGIN / REGISTRAZIONE UTENTE
// ------------------------------------------------------------
app.post("/login", async (req, res) => {
  const { phone, publicKey } = req.body;

  if (!phone || !publicKey) {
    return res.status(400).json({ error: "Missing phone or publicKey" });
  }

  try {
    // Cerca utente esistente
    const existing = await pool.query(
      "SELECT * FROM users WHERE phone = $1",
      [phone]
    );

    if (existing.rows.length > 0) {
      // Aggiorna la chiave pubblica
      await pool.query(
        "UPDATE users SET public_key = $1 WHERE phone = $2",
        [publicKey, phone]
      );

      return res.json({ success: true });
    }

    // Crea nuovo utente
    await pool.query(
      "INSERT INTO users (phone, public_key) VALUES ($1, $2)",
      [phone, publicKey]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Errore /login:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// 2️⃣ REGISTRAZIONE CHIAVE PUBBLICA
// ------------------------------------------------------------
app.post("/keys/register", async (req, res) => {
  const { user_id, public_key } = req.body;

  if (!user_id || !public_key) {
    return res.status(400).json({ error: "Missing user_id or public_key" });
  }

  try {
    await pool.query(
      "UPDATE users SET public_key = $1 WHERE id = $2",
      [public_key, user_id]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Errore /keys/register:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// 3️⃣ RECUPERO CHIAVE PUBBLICA
// ------------------------------------------------------------
app.get("/keys/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      "SELECT public_key FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json({ public_key: result.rows[0].public_key });
  } catch (err) {
    console.error("Errore /keys/:userId:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// AVVIO SERVER
// ------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server attivo su porta ${PORT}`));