import express from "express";
import pool from "./db.js";

const router = express.Router();

// 1. INVIA UN MESSAGGIO
router.post("/send-message", async (req, res) => {
  try {
    const { sender_id, receiver_id, content } = req.body;
    if (!sender_id || !receiver_id || !content) {
      return res.status(400).json({ error: "Campi mancanti" });
    }
    const result = await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *",
      [sender_id, receiver_id, content]
    );
    res.json({ status: "ok", message: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. RECUPERA CRONOLOGIA MESSAGGI TRA DUE UTENTI
router.get("/messages/:user1/:user2", async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const result = await pool.query(
      `SELECT * FROM messages
       WHERE (sender_id = $1 AND receiver_id = $2)
       OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC`,
      [user1, user2]
    );
    res.json({ status: "ok", messages: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. SEGNA I MESSAGGI COME LETTI (Nuova funzione)
router.patch("/messages/read", async (req, res) => {
  try {
    const { sender_id, receiver_id } = req.body;
    if (!sender_id || !receiver_id) {
      return res.status(400).json({ error: "ID mittente o destinatario mancanti" });
    }
    
    // Chi riceve il messaggio segna come letti quelli inviati dall'altro
    await pool.query(
      "UPDATE messages SET is_read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND is_read = FALSE",
      [sender_id, receiver_id]
    );

    res.json({ success: true, message: "Stato lettura aggiornato" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. RECUPERA LISTA CONVERSAZIONI ATTIVE
router.get("/conversations/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const result = await pool.query(
      `SELECT DISTINCT
       CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS chat_with
       FROM messages WHERE sender_id = $1 OR receiver_id = $1`,
      [user_id]
    );
    res.json({ status: "ok", conversations: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. ELIMINA UN SINGOLO MESSAGGIO
router.delete("/delete-message/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM messages WHERE id = $1", [req.params.id]);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
