import express from "express";
import pool from "./db.js";

const router = express.Router();

// ------------------------------------------------------------
// MESSAGING — HTTP (Pagine 13-14)
// ------------------------------------------------------------
router.post("/send-message", async (req, res) => {
  try {
    const { sender_id, receiver_id, content } = req.body;
    if (!sender_id || !receiver_id || !content)
      return res.status(400).json({ error: "Missing fields" });

    const result = await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *",
      [sender_id, receiver_id, content]
    );
    res.json({ status: "ok", message: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.delete("/delete-message/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM messages WHERE id = $1", [req.params.id]);
    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — GESTIONE STANZE (Pagine 14-15-16-17)
// ------------------------------------------------------------
router.post("/chat/create", async (req, res) => {
  try {
    const { user1, user2 } = req.body;
    if (!user1 || !user2)
      return res.status(400).json({ error: "Missing users" });

    const existing = await pool.query(
      "SELECT id FROM chats WHERE (user1 = $1 AND user2 = $2) OR (user1 = $2 AND user2 = $1)",
      [user1, user2]
    );
    if (existing.rows.length > 0)
      return res.json({ chat_id: existing.rows[0].id });

    const result = await pool.query(
      "INSERT INTO chats (user1, user2) VALUES ($1, $2) RETURNING id",
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

router.post("/chat/send", async (req, res) => {
  try {
    const { chat_id, sender_id, content } = req.body;
    
    const result = await pool.query(
      "INSERT INTO chat_messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *",
      [chat_id, sender_id, content]
    );
    
    // ⭐ ESTRAZIONE CORRETTA: prendi il primo oggetto dell'array restituito da PostgreSQL
    const savedMessage = result.rows[0]; 

    if (req.io) {
      // Invia il payload formattato con i dati reali del database
      req.io.to(`chat_${chat_id}`).emit("new_message", {
        payload: {
          chatId: parseInt(chat_id),
          senderId: parseInt(sender_id),
          content: savedMessage.content,       // Ora non è più undefined
          createdAt: savedMessage.created_at, // Ora ha il timestamp corretto del DB
          type: "text"
        }
      });
      console.log(`📡 [WS GLOBAL] Messaggio distribuito in tempo reale alla stanza: chat_${chat_id}`);
    }

    // Risposta HTTP che vediamo nei tuoi log Flutter
    return res.json({ status: "ok", message: savedMessage });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


router.get("/chat/messages/:chat_id", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        id, 
        chat_id, 
        sender_id, 
        content, 
        created_at,
        'delivered' as status
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
// CHAT — PING & ACTIVE USERS (Pagine 17-18)
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
      "SELECT user_id FROM chat_active WHERE chat_id = $1 AND last_seen > NOW() - INTERVAL '60 seconds'",
      [req.params.chat_id]
    );
    return res.json({ active: result.rows.map((r) => r.user_id) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// VIDEOS & CONTACTS SYNC (Pagine 18, 21-22)
// ------------------------------------------------------------
router.post("/save-video", async (req, res) => {
  try {
    const { user_id, filename } = req.body;
    const result = await pool.query(
      "INSERT INTO videos (user_id, filename) VALUES ($1, $2) RETURNING *",
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

    console.log("📱 SYNC RICHIESTA DA USER:", userId);
    console.log("📞 NUMERI RICEVUTI:", phones ? phones.length : 0);

    if (!phones || !userId)
      return res.status(400).json({ error: "Missing data" });

    if (!phones.length)
      return res.json({ all_contacts: [], ww_contacts: [], chats: [], current_user: { id: userId } });

    // Normalizzazione numeri
    const cleanedPhones = phones.map((p) =>
      p.replace(/\s+/g, "").replace(/^\+/, "")
    );

    const wwResult = await pool.query(
      `SELECT id, name, last_name, phone, public_key, qr_data, peer_id, fingerprint, version 
       FROM users 
       WHERE RIGHT(REPLACE(phone, '+', ''), 9) = ANY(
         SELECT RIGHT(REPLACE(u, '+', ''), 9) FROM unnest($1::text[]) u
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

    const allContacts = cleanedPhones.map((p) => ({
      phone: "+" + p,
      name: originalNames?.[p] ?? "",
    }));

    return res.json({
      all_contacts: allContacts,
      ww_contacts: wwResult.rows,
      chats: chatResult.rows,
      current_user: { id: userId },
    });
  } catch (err) {
    console.error("❌ ERRORE SYNC:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
