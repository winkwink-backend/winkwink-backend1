import express from "express";
import fs from "fs";
import pool from "./db.js";
import admin from "./firebase-config.js"; // Importiamo admin per FCM diretto come a pag. 8

const router = express.Router();

// ------------------------------------------------------------
// INBOX (Pagina 6-7)
// ------------------------------------------------------------
router.get("/inbox/:user_id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM inbox WHERE to_user_id = $1 ORDER BY created_at DESC",
      [req.params.user_id]
    );
    return res.json({ inbox: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/inbox/create", async (req, res) => {
  try {
    const { to_user_id, from_user_id, type, payload } = req.body;
    const result = await pool.query(
      "INSERT INTO inbox (to_user_id, from_user_id, type, payload) VALUES ($1, $2, $3, $4) RETURNING *",
      [to_user_id, from_user_id, type, payload]
    );
    return res.json({ entry: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// P2P SESSION (FILE TRANSFER) (Pagine 7-8-9)
// ------------------------------------------------------------
router.post("/p2p/session/create", async (req, res) => {
  try {
    const { from_user_id, to_user_id, fileSize, fileType } = req.body;
    const sessionId = "sess_" + Date.now();

    // 1️⃣ CREA SESSIONE
    const result = await pool.query(
      `INSERT INTO p2p_sessions (session_id, from_user_id, to_user_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [sessionId, from_user_id, to_user_id]
    );

    // 2️⃣ SALVA IN INBOX
    await pool.query(
      `INSERT INTO inbox (to_user_id, from_user_id, type, payload)
       VALUES ($1, $2, 'file_transfer_request', $3)`,
      [to_user_id, from_user_id, { sessionId, fileSize, fileType }]
    );

    // 3️⃣ RECUPERO TOKEN DESTINATARIO PER FALLBACK FCM (Pagina 8)
    const receiver = await pool.query("SELECT fcm_token FROM users WHERE id = $1", [to_user_id]);
    const token = receiver.rows[0]?.fcm_token;

    if (token) {

  // Recupero nome mittente
  const sender = await pool.query(
    "SELECT name FROM users WHERE id = $1",
    [from_user_id]
  );
  const senderName = sender.rows[0]?.name ?? "";

  senderName: senderName

  await admin.messaging().send({
    token: token,
    data: {
      type: "incoming_file",
      sessionId: String(sessionId),
      fileName: "",
      fileType: String(fileType ?? ""),
      fileSize: String(fileSize ?? ""),
      fromUserId: String(from_user_id),
      senderName: senderName
    },
    android: { priority: "high" }
  });

  console.log(`📨 incoming_file via FCM → utente ${to_user_id}`);
}


    return res.json({
      delivered: token ? "fcm" : "none",
      session: result.rows[0],
      i18n_key: "file_transfer_waiting_accept"
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET SESSION BY ID (Pagina 9)
router.get("/p2p/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await pool.query("SELECT * FROM p2p_sessions WHERE session_id = $1", [sessionId]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Session not found" });
    return res.json({ session: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// P2P CHAT WEBRTC SIGNALING (Pagine 10-11)
// ------------------------------------------------------------
router.post("/p2p/chat/offer", async (req, res) => {
  try {
    const { from_user_id, to_user_id, offer } = req.body;
    await pool.query(
      `INSERT INTO p2p_chat (user_a, user_b, offer) VALUES ($1, $2, $3)
       ON CONFLICT (user_a, user_b)
       DO UPDATE SET offer = EXCLUDED.offer, answer = NULL, candidates = '[]'::jsonb, updated_at = NOW()`,
      [from_user_id, to_user_id, offer]
    );
    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/p2p/chat/offer", async (req, res) => {
  try {
    const { my_user_id, other_user_id } = req.query;
    const result = await pool.query(
      `SELECT offer FROM p2p_chat WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)`,
      [my_user_id, other_user_id]
    );
    return res.json({ offer: result.rows[0]?.offer || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post("/p2p/chat/candidate", async (req, res) => {
  try {
    const { from_user_id, to_user_id, candidate } = req.body;
    await pool.query(
      `UPDATE p2p_chat SET candidates = candidates || $1::jsonb, updated_at = NOW()
       WHERE (user_a = $2 AND user_b = $3) OR (user_a = $3 AND user_b = $2)`,
      [JSON.stringify([candidate]), from_user_id, to_user_id]
    );
    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/p2p/chat/candidates", async (req, res) => {
  try {
    const { my_user_id, other_user_id } = req.query;
    const result = await pool.query(
      `SELECT candidates FROM p2p_chat WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)`,
      [my_user_id, other_user_id]
    );
    return res.json({ candidates: result.rows[0]?.candidates || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
