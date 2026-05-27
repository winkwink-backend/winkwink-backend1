import express from "express";
import pool from "./db.js";
import { sendFCM } from "./firebase-config.js";

const router = express.Router();

// ------------------------------------------------------------
// MESSAGING — HTTP (vecchia tabella "messages")
// ------------------------------------------------------------
router.post("/send-message", async (req, res) => {
  try {
    const { sender_id, receiver_id, content, type } = req.body;

    if (!sender_id || !receiver_id || !content)
      return res.status(400).json({ error: "Missing fields" });

    console.log(`🔎 [BACKEND FCM] Invio messaggio da user ${sender_id} a user ${receiver_id}`);

    const result = await pool.query(
      `INSERT INTO messages (sender_id, receiver_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [sender_id, receiver_id, content]
    );

    const savedMessage = result.rows[0];

    // WebSocket broadcast
    if (req.io) {
      req.io.emit("new_message", {
        payload: {
          senderId: parseInt(sender_id),
          receiverId: parseInt(receiver_id),
          content: savedMessage.content,
          createdAt: savedMessage.created_at,
          type: type ?? "text"
        }
      });
    }

    // Notifica FCM
    try {
      const userRes = await pool.query(
        `SELECT fcm_token,
                (SELECT name FROM users WHERE id = $1) as sender_name
         FROM users WHERE id = $2`,
        [sender_id, receiver_id]
      );

      const recipientData = userRes.rows[0];

      if (recipientData && recipientData.fcm_token) {
        await sendFCM({
          token: recipientData.fcm_token,
          title: `Messaggio da ${recipientData.sender_name || "WinkWink"}`,
          body: content,
          data: {
            type: "chat",
            senderId: String(sender_id),
            receiverId: String(receiver_id)
          }
        });
      }
    } catch (fcmErr) {
      console.log("⚠️ [BACKEND FCM ERRORE]:", fcmErr.message);
    }

    return res.json({ status: "ok", message: savedMessage });

  } catch (err) {
    console.error("❌ [BACKEND CRITICAL ERROR]:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get("/messages/:user1/:user2", async (req, res) => {
  try {
    const { user1, user2 } = req.params;

    const result = await pool.query(
      `SELECT *
       FROM messages
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

router.get("/conversations/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT DISTINCT
         CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS chat_with
       FROM messages
       WHERE sender_id = $1 OR receiver_id = $1`,
      [user_id]
    );

    res.json({ status: "ok", conversations: result.rows });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/delete-message/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM messages WHERE id = $1", [req.params.id]);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — GESTIONE STANZE
// ------------------------------------------------------------
router.post("/chat/create", async (req, res) => {
  try {
    const { user1, user2 } = req.body;

    if (!user1 || !user2)
      return res.status(400).json({ error: "Missing users" });

    const existing = await pool.query(
      `SELECT id FROM chats
       WHERE (user1 = $1 AND user2 = $2)
       OR (user1 = $2 AND user2 = $1)`,
      [user1, user2]
    );

    if (existing.rows.length > 0)
      return res.json({ chat_id: existing.rows[0].id });

    const result = await pool.query(
      `INSERT INTO chats (user1, user2)
       VALUES ($1, $2)
       RETURNING id`,
      [user1, user2]
    );

    return res.json({ chat_id: result.rows[0].id });

  } catch (err) {
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/chat/list/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT
         c.id AS chat_id,
         u.id AS other_id,
         u.name,
         u.last_name,
         u.public_key,
         (SELECT content FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message,
         (SELECT created_at FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_timestamp
       FROM chats c
       JOIN users u ON u.id = CASE WHEN c.user1 = $1 THEN c.user2 ELSE c.user1 END
       WHERE c.user1 = $1 OR c.user2 = $1
       ORDER BY last_timestamp DESC NULLS LAST`,
      [user_id]
    );

    return res.json({ chats: result.rows });

  } catch (err) {
    console.error("❌ Errore recupero lista chat:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — INVIO MESSAGGI (NUOVA TABELLA chat_messages)
// ------------------------------------------------------------
router.post("/chat/send", async (req, res) => {
  try {
    const { chat_id, sender_id, receiver_id, content, type } = req.body;

    console.log(`🔎 [BACKEND] Invio messaggio → chat_${chat_id} da user_${sender_id}`);

    if (!chat_id || !sender_id || !receiver_id || !content)
      return res.status(400).json({ error: "Missing fields" });

    const result = await pool.query(
      `INSERT INTO chat_messages (chat_id, sender_id, receiver_id, content, type, status)
       VALUES ($1, $2, $3, $4, $5, 'sent')
       RETURNING *`,
      [
        chat_id,
        sender_id,
        receiver_id,
        content,
        type ?? "text"
      ]
    );

    const savedMessage = result.rows[0];

    // WebSocket
    if (req.io) {
      req.io.to(`chat_${chat_id}`).emit("new_message", {
        chat_id: parseInt(chat_id),
        sender_id: parseInt(sender_id),
        receiver_id: parseInt(receiver_id),
        content: savedMessage.content,
        type: savedMessage.type,
        status: savedMessage.status,
        created_at: savedMessage.created_at
      });
    }

    // Notifica push
    try {
      const userRes = await pool.query(
        `SELECT u.fcm_token,
                (SELECT name FROM users WHERE id = $1) as sender_name
         FROM users u
         JOIN chats c ON (u.id = c.user1 OR u.id = c.user2)
         WHERE c.id = $2 AND u.id != $1
         LIMIT 1`,
        [sender_id, chat_id]
      );

      const recipientData = userRes.rows[0];

      if (recipientData && recipientData.fcm_token) {
        await sendFCM({
          token: recipientData.fcm_token,
          title: `Messaggio da ${recipientData.sender_name || "WinkWink"}`,
          body: content,
          data: {
            type: "chat",
            chatId: String(chat_id),
            senderId: String(sender_id)
          }
        });
      }

    } catch (fcmErr) {
      console.log("⚠️ [BACKEND FCM ERRORE]:", fcmErr.message);
    }

    return res.json({ status: "ok", message: savedMessage });

  } catch (err) {
    console.error("❌ [BACKEND CRITICAL ERROR]:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — RECUPERO MESSAGGI
// ------------------------------------------------------------
router.get("/chat/messages/:chat_id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         id,
         chat_id,
         sender_id,
         receiver_id,
         content,
         type,
         status,
         created_at
       FROM chat_messages
       WHERE chat_id = $1
       ORDER BY created_at ASC`,
      [req.params.chat_id]
    );

    res.json({ messages: result.rows });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — PING & ACTIVE USERS
// ------------------------------------------------------------
router.post("/chat/ping", async (req, res) => {
  try {
    const { chat_id, user_id } = req.body;

    await pool.query(
      `INSERT INTO chat_active (chat_id, user_id, last_seen)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chat_id, user_id)
       DO UPDATE SET last_seen = NOW()`,
      [chat_id, user_id]
    );

    return res.json({ ok: true });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/chat/active/:chat_id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id
       FROM chat_active
       WHERE chat_id = $1
       AND last_seen > NOW() - INTERVAL '60 seconds'`,
      [req.params.chat_id]
    );

    return res.json({ active: result.rows.map(r => r.user_id) });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// VIDEOS & CONTACTS SYNC
// ------------------------------------------------------------
router.post("/save-video", async (req, res) => {
  try {
    const { user_id, filename } = req.body;

    const result = await pool.query(
      `INSERT INTO videos (user_id, filename)
       VALUES ($1, $2)
       RETURNING *`,
      [user_id, filename]
    );

    res.json({ status: "ok", video: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/contacts/sync", async (req, res) => {
  try {
    let { phones, userId, originalNames } = req.body;

    if (!phones || !userId)
      return res.status(400).json({ error: "Missing data" });

    if (!phones.length)
      return res.json({
        all_contacts: [],
        ww_contacts: [],
        chats: [],
        current_user: { id: userId }
      });

    const cleanedPhones = phones.map(p =>
      p.replace(/\s+/g, "").replace(/^\+/, "")
    );

    const wwResult = await pool.query(
      `SELECT id, name, last_name, phone, public_key, qr_data, peer_id, fingerprint, version
       FROM users
       WHERE RIGHT(REPLACE(phone, '+', ''), 9) = ANY(
         SELECT RIGHT(REPLACE(u, '+', ''), 9)
         FROM unnest($1::text[]) u
       )`,
      [cleanedPhones]
    );

    const chatResult = await pool.query(
      `SELECT
         c.id AS chat_id,
         CASE WHEN c.user1 = $1 THEN c.user2 ELSE c.user1 END AS other_id,
         u.name AS other_name,
         (SELECT content FROM chat_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) AS last_message
       FROM chats c
       JOIN users u ON u.id = CASE WHEN c.user1 = $1 THEN c.user2 ELSE c.user1 END
       WHERE c.user1 = $1 OR c.user2 = $1`,
      [userId]
    );

    const allContacts = cleanedPhones.map(p => ({
      phone: "+" + p,
      name: originalNames?.[p] ?? ""
    }));

    return res.json({
      all_contacts: allContacts,
      ww_contacts: wwResult.rows,
      chats: chatResult.rows,
      current_user: { id: userId }
    });

  } catch (err) {
    console.error("❌ ERRORE SYNC:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// 🗑️ CANCELLA TUTTI I MESSAGGI DI UNA CHAT
router.delete("/chat/:chatId/clear", async (req, res) => {
  const { chatId } = req.params;

  try {
    await pool.query("DELETE FROM chat_messages WHERE chat_id = $1", [chatId]);
    return res.json({ success: true });
  } catch (err) {
    console.error("Errore cancellazione chat:", err);
    return res.status(500).json({ success: false });
  }
});


export default router;
