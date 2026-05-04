import express from "express";
import pool from "./db.js";

const router = express.Router();

// Ottieni dati profilo singolo utente
router.get("/users/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email, created_at FROM users WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Utente non trovato" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggiorna nome profilo
router.put("/users/:id", async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query("UPDATE users SET name = $1 WHERE id = $2", [name, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
