import express from "express";
import pool from "./db.js";

const router = express.Router();

// Recupera cronologia file ricevuti/inviati
router.get("/files/history/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM p2p_sessions WHERE from_user_id = $1 OR to_user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ricerca utenti per nome o email (per iniziare nuove chat)
router.get("/users/search", async (req, res) => {
  const { query } = req.query;
  try {
    const result = await pool.query(
      "SELECT id, name, email FROM users WHERE name ILIKE $1 OR email ILIKE $1 LIMIT 10",
      [`%${query}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
