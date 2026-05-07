import express from "express";
import pool from "./db.js";

const router = express.Router();

// ---------------------------------------------------------
// ⭐ NUOVA ROTTA: Accettazione File via HTTP (Fix Android)
// ---------------------------------------------------------
router.post("/file_accept_http", async (req, res) => {
  const { sessionId, userId } = req.body;

  console.log(`📩 [HTTP POST] Ricevuta accettazione: Sessione ${sessionId} da Utente ${userId}`);

  if (!sessionId || !userId) {
    console.error("❌ [HTTP ERROR] Parametri mancanti nella richiesta");
    return res.status(400).json({ 
      error: "Parametri sessionId o userId mancanti" 
    });
  }

  try {
    // Qui aggiorni lo stato della sessione nel database se necessario
    // Esempio: await pool.query("UPDATE p2p_sessions SET status = 'accepted' WHERE session_id = $1", [sessionId]);

    console.log(`✅ [HTTP SUCCESS] Sessione ${sessionId} registrata correttamente`);
    
    res.status(200).json({ 
      success: true,
      message: "Accettazione ricevuta dal server",
      sessionId,
      userId 
    });
  } catch (err) {
    console.error("❌ [SERVER ERROR] Errore nel salvataggio accettazione:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------
// Recupera cronologia file ricevuti/inviati
// ---------------------------------------------------------
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

// ---------------------------------------------------------
// Ricerca utenti per nome o email
// ---------------------------------------------------------
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
