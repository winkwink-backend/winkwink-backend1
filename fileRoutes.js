import express from "express";
import pool from "./db.js";
import { sendFCM } from "./firebase-config.js";

const router = express.Router();

// ---------------------------------------------------------
// ⭐ ACCETTAZIONE FILE VIA HTTP (PATCH COMPLETA)
// ---------------------------------------------------------
router.post("/file_accept_http", async (req, res) => {
  const { sessionId, userId } = req.body;

  console.log(`📩 [HTTP POST] Accettazione ricevuta → sessionId=${sessionId}, userId=${userId}`);

  if (!sessionId || !userId) {
    console.error("❌ Parametri mancanti");
    return res.status(400).json({ error: "Parametri sessionId o userId mancanti" });
  }

  try {
    // 1️⃣ Recupero sessione
    const result = await pool.query(
      "SELECT * FROM p2p_sessions WHERE session_id = $1",
      [sessionId]
    );

    if (result.rows.length === 0) {
      console.log("❌ Nessuna sessione trovata nel DB");
      return res.status(404).json({ error: "Session not found" });
    }

    const session = result.rows[0];
    const senderId = session.from_user_id;
    const receiverId = session.to_user_id;

    console.log("📦 Sessione trovata:", session);

    // 2️⃣ Recupero socket del mittente
    const senderSocketId = req.app.get("onlineUsers").get(String(senderId));

    // 3️⃣ Payload da inviare al mittente
    const payload = {
      sessionId,
      fileName: session.file_name,
      fileType: session.file_type,
      fileSize: session.file_size,
      receiverId
    };

    // 4️⃣ Mittente ONLINE → WebSocket
    if (senderSocketId) {
      console.log("📡 Mittente online → invio start_sending_file via WS");
      req.app.get("io").to(senderSocketId).emit("start_sending_file", payload);
    } else {
      // 5️⃣ Mittente OFFLINE → FCM
      console.log("📵 Mittente offline → invio FCM start_sending_file");

      const tokenRes = await pool.query(
        "SELECT fcm_token FROM users WHERE id = $1",
        [senderId]
      );

      const token = tokenRes.rows[0]?.fcm_token;

      if (token) {
        await sendFCM({
          token,
          data: {
            type: "start_sending_file",
            ...Object.fromEntries(
              Object.entries(payload).map(([k, v]) => [k, String(v)])
            )
          }
        });
      } else {
        console.log("⚠️ Nessun token FCM per il mittente");
      }
    }

    // 6️⃣ Risposta HTTP
    console.log("✅ Accettazione gestita correttamente");
    res.status(200).json({
      success: true,
      message: "Accettazione elaborata",
      sessionId,
      senderId,
      receiverId
    });

  } catch (err) {
    console.error("❌ Errore nel file_accept_http:", err.message);
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
