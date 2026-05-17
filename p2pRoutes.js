import express from "express";
import fs from "fs";
import pool from "./db.js";
import admin from "./firebase-config.js";

const router = express.Router();

// ------------------------------------------------------------
// ⭐ FOLDER RESPONSE (mittente ↔ ricevente)
// ------------------------------------------------------------

// Mappa globale per salvare le risposte
global.folderResponses = global.folderResponses || {};

// 🔵 RICEVENTE → invia risposta cartella
router.post("/p2p/session/folder_response", async (req, res) => {
  const { sessionId, status, error } = req.body;

  console.log("📡 [BACKEND] POST folder_response ARRIVATO:", req.body);

  global.folderResponses[sessionId] = { status, error };

  return res.json({ ok: true });
});

// 🔵 MITTENTE → chiede la risposta
router.get("/p2p/session/folder_response/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;

  const resp = global.folderResponses[sessionId];

  console.log("📡 [BACKEND] GET folder_response:", sessionId, resp);

  if (!resp) {
    return res.json({});
  }

  return res.json(resp);
});


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
    const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;
    const sessionId = String(Date.now());

    // 1️⃣ CREA SESSIONE (salvo anche metadati file)
    const result = await pool.query(
      `INSERT INTO p2p_sessions (session_id, from_user_id, to_user_id, file_size, file_type, file_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [sessionId, from_user_id, to_user_id, fileSize, fileType, fileName ?? ""]
    );

    // 2️⃣ SALVA IN INBOX (includo anche fileName)
    await pool.query(
      `INSERT INTO inbox (to_user_id, from_user_id, type, payload)
       VALUES ($1, $2, 'file_transfer_request', $3)`,
      [
        to_user_id,
        from_user_id,
        {
          sessionId,
          fileSize,
          fileType,
          fileName: fileName ?? "",
        },
      ]
    );

    // 3️⃣ RECUPERO TOKEN DESTINATARIO PER FALLBACK FCM
    const receiver = await pool.query(
      "SELECT fcm_token FROM users WHERE id = $1",
      [to_user_id]
    );
    const token = receiver.rows[0]?.fcm_token;

    if (token) {
      // Recupero nome mittente
      const sender = await pool.query(
        "SELECT name FROM users WHERE id = $1",
        [from_user_id]
      );
      const senderName = sender.rows[0]?.name ?? "";

      // 🔥 PATCH: costruisco il payload SENZA campi vuoti
      const data = {
        type: "incoming_file",
        sessionId: String(sessionId),
        fromUserId: String(from_user_id),
        senderName: senderName,
      };

      if (fileName) data.fileName = String(fileName);
      if (fileType) data.fileType = String(fileType);
      if (fileSize) data.fileSize = String(fileSize);

      await admin.messaging().send({
        token: token,
        data,
        android: { priority: "high" },
      });

      console.log(`📨 incoming_file via FCM → utente ${to_user_id}`);
    }

    return res.json({
      delivered: token ? "fcm" : "none",
      session: result.rows[0],
      i18n_key: "file_transfer_waiting_accept",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET SESSION BY ID (Pagina 9)
router.get("/p2p/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await pool.query(
      "SELECT * FROM p2p_sessions WHERE session_id = $1",
      [sessionId]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Session not found" });
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

