// ------------------------------------------------------------
// DOTENV
// ------------------------------------------------------------

import pkg from 'pg';
const { Pool } = pkg;

import dotenv from 'dotenv';
dotenv.config();

import express from "express";
import multer from "multer";
import cors from "cors";
import { exec } from "child_process";
import fs from "fs";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import { createServer } from "http";
import { Server } from "socket.io";

// 1. CONFIGURAZIONE DB 
const pool = new Pool({
  connectionString: "postgres://winkwink_db_user:OrCTUsRf6pIFyufs4uNx9m15bvgXIXjP@://render.com",
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()', (err) => {
  if (err) console.error("❌ Errore critico DB:", err);
  else console.log("✅ Database connesso correttamente");
});

// 2. SETUP EXPRESS (Una volta sola!)
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

console.log(">>> SERVER.JS CARICATO <<<");

app.get("/debug", (req, res) => {
  res.json({
    status: "online",
    message: "Il server Node è finalmente online!"
  });
});

// ------------------------------------------------------------
// NODEMAILER (SMTP Outlook)
// ------------------------------------------------------------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// ------------------------------------------------------------
// OTP STORE
// ------------------------------------------------------------
const otpStore = new Map();
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ------------------------------------------------------------
// AUTH — REGISTER
// ------------------------------------------------------------
app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0)
      return res.status(409).json({ error: "User already exists" });

    const password_hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at",
      [email, password_hash]
    );

    res.json({ status: "ok", user: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// AUTH — LOGIN (ECC / PHONE + PUBLIC KEY)
// ------------------------------------------------------------
app.post("/login", async (req, res) => {
  try {
    const { phone, name, last_name, public_key, qr_data } = req.body;

    // Usiamo una query che inserisce tutto e restituisce l'ID
    const result = await pool.query(
      `INSERT INTO users (phone, name, last_name, public_key, qr_data, peer_id)
       VALUES ($1, $2, $3, $4, $5, '0') 
       ON CONFLICT (phone) 
       DO UPDATE SET 
          name = EXCLUDED.name,
          last_name = EXCLUDED.last_name,
          public_key = EXCLUDED.public_key,
          qr_data = EXCLUDED.qr_data
       RETURNING *;`,
      [phone, name, last_name, public_key, qr_data]
    );

    const user = result.rows[0];

    // ⭐ TRUCCO: Se peer_id è '0' o NULL, lo aggiorniamo subito con l'ID reale
    if (user.peer_id === '0' || !user.peer_id) {
      await pool.query("UPDATE users SET peer_id = $1 WHERE id = $1", [user.id]);
      user.peer_id = user.id.toString();
    }

    res.json({ success: true, user: user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// PASSWORD RESET — REQUEST OTP
// ------------------------------------------------------------
app.post("/password-reset/request", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return res.status(400).json({ error: "Email mancante" });

    const result = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0)
      return res.json({ message: "Se l'email esiste, riceverai un codice" });

    const code = generateOtp();
    const expiresAt = Date.now() + 10 * 60 * 1000;

    otpStore.set(email, { code, expiresAt });

    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: "WinkWink - Codice recupero password",
      text: `Il tuo codice è: ${code}\nValido 10 minuti.`
    });

    return res.json({ message: "Codice inviato" });

  } catch (err) {
    return res.status(500).json({ error: "Errore durante l'invio del codice" });
  }
});

// ------------------------------------------------------------
// PASSWORD RESET — VERIFY OTP
// ------------------------------------------------------------
app.post("/password-reset/verify", (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp)
      return res.status(400).json({ error: "Dati mancanti" });

    const entry = otpStore.get(email);

    if (!entry)
      return res.status(400).json({ error: "Codice non valido" });

    const { code, expiresAt } = entry;

    if (Date.now() > expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ error: "Codice scaduto" });
    }

    if (otp !== code)
      return res.status(400).json({ error: "Codice non valido" });

    return res.json({ message: "Codice verificato" });

  } catch (err) {
    return res.status(500).json({ error: "Errore durante la verifica" });
  }
});

// ------------------------------------------------------------
// PASSWORD RESET — NEW PASSWORD
// ------------------------------------------------------------
app.post("/password-reset/new", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: "Dati mancanti" });

    const entry = otpStore.get(email);

    if (!entry)
      return res.status(400).json({ error: "OTP non verificato" });

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE email = $2",
      [hash, email]
    );

    otpStore.delete(email);

    return res.json({ message: "Password aggiornata" });

  } catch (err) {
    return res.status(500).json({ error: "Errore durante il salvataggio della password" });
  }
});

// ------------------------------------------------------------
// AUTH — CHECK EMAIL
// ------------------------------------------------------------
app.post("/auth/check-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return res.status(400).json({ error: "Email required" });

    const result = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    return res.json({ exists: result.rows.length > 0 });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// KEYS — PUBLIC KEY EXCHANGE
// ------------------------------------------------------------
app.post("/keys/register", async (req, res) => {
  try {
    const { user_id, public_key } = req.body;

    if (!user_id || !public_key)
      return res.status(400).json({ error: "Missing fields" });

    await pool.query(
      "UPDATE users SET public_key = $1 WHERE id = $2",
      [public_key, user_id]
    );

    return res.json({ status: "ok" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/keys/:user_id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT public_key FROM users WHERE id = $1",
      [req.params.user_id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    return res.json({ public_key: result.rows[0].public_key });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// INBOX
// ------------------------------------------------------------
app.get("/inbox/:user_id", async (req, res) => {
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

app.post("/inbox/create", async (req, res) => {
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
// CHAT INVITE — INVITA UN UTENTE AD UNA CHAT ESISTENTE
// ------------------------------------------------------------
app.post("/chat/invite", async (req, res) => {
  try {
    const { from_user_id, to_user_id, chat_with } = req.body;

    if (!from_user_id || !to_user_id || !chat_with) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const payload = {
      type: "chat_invite",
      from_user_id,
      chat_with,
      message: "Ti hanno invitato in una chat"
    };

    const result = await pool.query(
      `INSERT INTO inbox (to_user_id, from_user_id, type, payload)
       VALUES ($1, $2, 'chat_invite', $3)
       RETURNING *`,
      [to_user_id, from_user_id, payload]
    );

    return res.json({ status: "ok", invite: result.rows[0] });

  } catch (err) {
    console.error("CHAT INVITE ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// P2P SESSION (FILE TRANSFER)
// ------------------------------------------------------------
app.post("/p2p/session/create", async (req, res) => {
  try {
    const { from_user_id, to_user_id, fileSize, fileType } = req.body;

    const sessionId = "sess_" + Date.now();

    const result = await pool.query(
      `INSERT INTO p2p_sessions (session_id, from_user_id, to_user_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [sessionId, from_user_id, to_user_id]
    );

    await pool.query(
      `INSERT INTO inbox (to_user_id, from_user_id, type, payload)
       VALUES ($1, $2, 'file_transfer_request', $3)`,
      [to_user_id, from_user_id, { sessionId, fileSize, fileType }]
    );

    return res.json({ session: result.rows[0] });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/p2p/session/offer", async (req, res) => {
  try {
    const { session_id, offer } = req.body;

    await pool.query(
      "UPDATE p2p_sessions SET offer = $1 WHERE session_id = $2",
      [offer, session_id]
    );

    return res.json({ status: "ok" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/p2p/session/answer", async (req, res) => {
  try {
    const { session_id, answer } = req.body;

    await pool.query(
      "UPDATE p2p_sessions SET answer = $1 WHERE session_id = $2",
      [answer, session_id]
    );

    return res.json({ status: "ok" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/p2p/session/candidate", async (req, res) => {
  try {
    const { session_id, candidate } = req.body;

    await pool.query(
      "UPDATE p2p_sessions SET candidates = candidates || $1::jsonb WHERE session_id = $2",
      [JSON.stringify([candidate]), session_id]
    );

    return res.json({ status: "ok" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
// ------------------------------------------------------------
// ⭐⭐ P2P CHAT WEBRTC — NUOVA SEZIONE COMPLETA ⭐⭐
// ------------------------------------------------------------

// CREA/AGGIORNA OFFER
app.post("/p2p/chat/offer", async (req, res) => {
  try {
    const { from_user_id, to_user_id, offer } = req.body;

    await pool.query(
      `
      INSERT INTO p2p_chat (user_a, user_b, offer)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_a, user_b)
      DO UPDATE SET offer = EXCLUDED.offer, answer = NULL, candidates = '[]'::jsonb, updated_at = NOW()
      `,
      [from_user_id, to_user_id, offer]
    );

    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// RECUPERA OFFER
app.get("/p2p/chat/offer", async (req, res) => {
  console.log(">>> VERSIONE CORRETTA ATTIVA");
  try {
    const { my_user_id, other_user_id } = req.query;

    const result = await pool.query(
      `
      SELECT offer FROM p2p_chat
      WHERE (user_a = $1 AND user_b = $2)
         OR (user_a = $2 AND user_b = $1)
      `,
      [my_user_id, other_user_id]
    );

    if (result.rows.length === 0)
      return res.json({ offer: null });

    return res.json({ offer: result.rows[0].offer });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// INVIA ANSWER
app.post("/p2p/chat/answer", async (req, res) => {
  try {
    const { from_user_id, to_user_id, answer } = req.body;

    await pool.query(
      `
      UPDATE p2p_chat
      SET answer = $1, updated_at = NOW()
      WHERE (user_a = $2 AND user_b = $3)
         OR (user_a = $3 AND user_b = $2)
      `,
      [answer, from_user_id, to_user_id]
    );

    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// INVIA ICE CANDIDATE
app.post("/p2p/chat/candidate", async (req, res) => {
  try {
    const { from_user_id, to_user_id, candidate } = req.body;

    await pool.query(
      `
      UPDATE p2p_chat
      SET candidates = candidates || $1::jsonb, updated_at = NOW()
      WHERE (user_a = $2 AND user_b = $3)
         OR (user_a = $3 AND user_b = $2)
      `,
      [JSON.stringify([candidate]), from_user_id, to_user_id]
    );

    return res.json({ status: "ok" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// RECUPERA ICE CANDIDATES
// ------------------------------------------------------------
app.get("/p2p/chat/candidates", async (req, res) => {
  try {
    const { my_user_id, other_user_id } = req.query;

    const result = await pool.query(
      `
      SELECT candidates FROM p2p_chat
      WHERE (user_a = $1 AND user_b = $2)
         OR (user_a = $2 AND user_b = $1)
      `,
      [my_user_id, other_user_id]
    );

    if (result.rows.length === 0)
      return res.json({ candidates: [] });

    return res.json({ candidates: result.rows[0].candidates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// FILES FALLBACK
// ------------------------------------------------------------
app.post("/files/upload", upload.single("file"), async (req, res) => {
  try {
    const { user_id } = req.body;

    const result = await pool.query(
      `INSERT INTO fallback_files (owner_user_id, file_path, size, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')
       RETURNING id`,
      [user_id, req.file.path, req.file.size]
    );

    return res.json({ fileId: result.rows[0].id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/files/download/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT file_path FROM fallback_files WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ error: "File not found" });

    const filePath = result.rows[0].file_path;

    res.download(filePath, () => {
      fs.unlinkSync(filePath);
      pool.query("DELETE FROM fallback_files WHERE id = $1", [req.params.id]);
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// MESSAGING
// ------------------------------------------------------------
app.post("/send-message", async (req, res) => {
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

app.get("/messages/:user1/:user2", async (req, res) => {
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

app.get("/conversations/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT DISTINCT
         CASE
           WHEN sender_id = $1 THEN receiver_id
           ELSE sender_id
         END AS chat_with
       FROM messages
       WHERE sender_id = $1 OR receiver_id = $1`,
      [user_id]
    );

    res.json({ status: "ok", conversations: result.rows });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/delete-message/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM messages WHERE id = $1", [req.params.id]);
    res.json({ status: "ok" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — CREA O RECUPERA CHAT TRA DUE UTENTI
// ------------------------------------------------------------
app.post("/chat/create", async (req, res) => {
  try {
    const { user1, user2 } = req.body;

    if (!user1 || !user2) {
      return res.status(400).json({ error: "Missing user1 or user2" });
    }

    // 1️⃣ Cerca chat esistente
    const existing = await pool.query(
      `
      SELECT id FROM chats
      WHERE (user1 = $1 AND user2 = $2)
         OR (user1 = $2 AND user2 = $1)
      `,
      [user1, user2]
    );

    if (existing.rows.length > 0) {
      return res.json({ chat_id: existing.rows[0].id });
    }

    // 2️⃣ Crea nuova chat
    const result = await pool.query(
      `
      INSERT INTO chats (user1, user2)
      VALUES ($1, $2)
      RETURNING id
      `,
      [user1, user2]
    );

    return res.json({ chat_id: result.rows[0].id });

  } catch (err) {
    console.error("CHAT CREATE ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// ⭐ CHAT — LISTA CHAT PER UN UTENTE (PATCH AGGIUNTA)
// ------------------------------------------------------------
app.get("/chat/list/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        c.id AS chat_id,
        CASE 
          WHEN c.user1 = $1 THEN c.user2
          ELSE c.user1
        END AS other_id,
        u.name AS other_name,
        (
          SELECT content 
          FROM chat_messages 
          WHERE chat_id = c.id 
          ORDER BY created_at DESC 
          LIMIT 1
        ) AS last_message,
        (
          SELECT created_at 
          FROM chat_messages 
          WHERE chat_id = c.id 
          ORDER BY created_at DESC 
          LIMIT 1
        ) AS last_timestamp
      FROM chats c
      JOIN users u 
        ON u.id = CASE 
                    WHEN c.user1 = $1 THEN c.user2
                    ELSE c.user1
                  END
      WHERE c.user1 = $1 OR c.user2 = $1
      ORDER BY last_timestamp DESC NULLS LAST
      `,
      [user_id]
    );

    return res.json({ chats: result.rows });

  } catch (err) {
    console.error("ERRORE /chat/list:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — INVIA MESSAGGIO
// ------------------------------------------------------------
app.post("/chat/send", async (req, res) => {
  try {
    const { chat_id, sender_id, content } = req.body;

    if (!chat_id || !sender_id || !content)
      return res.status(400).json({ error: "Missing fields" });

    const result = await pool.query(
      `INSERT INTO chat_messages (chat_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [chat_id, sender_id, content]
    );

    return res.json({ message: result.rows[0] });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — LISTA MESSAGGI
// ------------------------------------------------------------
app.get("/chat/messages/:chat_id", async (req, res) => {
  try {
    const { chat_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM chat_messages
       WHERE chat_id = $1
       ORDER BY created_at ASC`,
      [chat_id]
    );

    return res.json({ messages: result.rows });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — PING UTENTE ATTIVO NELLA CHAT
// ------------------------------------------------------------
app.post("/chat/ping", async (req, res) => {
  try {
    const { chat_id, user_id } = req.body;

    if (!chat_id || !user_id)
      return res.status(400).json({ error: "Missing fields" });

    await pool.query(
      `
      INSERT INTO chat_active (chat_id, user_id, last_seen)
      VALUES ($1, $2, NOW())
      ON CONFLICT (chat_id, user_id)
      DO UPDATE SET last_seen = NOW()
      `,
      [chat_id, user_id]
    );

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// CHAT — UTENTI ATTIVI NELLA CHAT
// ------------------------------------------------------------
app.get("/chat/active/:chat_id", async (req, res) => {
  try {
    const { chat_id } = req.params;

    const result = await pool.query(
      `
      SELECT user_id
      FROM chat_active
      WHERE chat_id = $1
        AND last_seen > NOW() - INTERVAL '60 seconds'
      `,
      [chat_id]
    );

    return res.json({
      active: result.rows.map(r => r.user_id)
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// VIDEOS
// ------------------------------------------------------------
app.post("/save-video", async (req, res) => {
  try {
    const { user_id, filename } = req.body;

    if (!user_id || !filename)
      return res.status(400).json({ error: "user_id and filename required" });

    const result = await pool.query(
      "INSERT INTO videos (user_id, filename) VALUES ($1, $2) RETURNING id, user_id, filename, created_at",
      [user_id, filename]
    );

    res.json({ status: "ok", video: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/videos/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      "SELECT id, filename, created_at FROM videos WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]
    );

    res.json({ status: "ok", videos: result.rows });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// ENCODE / EXTRACT
// ------------------------------------------------------------
app.post("/encode", upload.array("files"), async (req, res) => {
  try {
    const audio = req.files.find(f => f.originalname.endsWith(".mp3"));
    const frames = req.files.filter(f => f !== audio);

    if (!audio || frames.length === 0)
      return res.status(400).json({ error: "Missing frames or audio" });

    const framesDir = `frames_${Date.now()}`;
    fs.mkdirSync(framesDir);

    frames.forEach((f, i) => {
      fs.renameSync(f.path, `${framesDir}/frame_${String(i).padStart(5, "0")}.png`);
    });

    const output = `output_${Date.now()}.mp4`;

    const cmd = `
      ffmpeg -y \
      -framerate 30 -i ${framesDir}/frame_%05d.png \
      -i ${audio.path} \
      -c:v libx264 -pix_fmt yuv420p \
      -c:a aac \
      ${output}
    `;

    exec(cmd, (error, stdout, stderr) => {
      fs.rmSync(framesDir, { recursive: true, force: true });

      if (error) {
        console.error("FFmpeg error:", error);
        return res.status(500).json({ error: "Encoding failed" });
      }

      res.json({ status: "ok", output });
    });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// USERS — CHECK PHONE
// ------------------------------------------------------------
app.get("/users/check", async (req, res) => {
  console.log(">>> /users/check CARICATO <<<");

  try {
    let phone = req.query.phone;

    if (!phone)
      return res.status(400).json({ error: "Phone required" });

    phone = decodeURIComponent(phone);
    phone = phone.replace(/\s+/g, "");
    phone = phone.replace(/^\+/, "");

    if (!phone.startsWith("39")) {
      phone = "39" + phone;
    }

    phone = "+" + phone;

    console.log("PHONE NORMALIZZATO:", phone);

    const result = await pool.query(
      "SELECT id, public_key FROM users WHERE phone = $1",
      [phone]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    return res.json({
      exists: true,
      userId: result.rows[0].id,
      publicKey: result.rows[0].public_key
    });

  } catch (err) {
    console.error("CHECK ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// CONTACTS — CHECK WHICH PHONES ARE WINKWINK USERS
// ------------------------------------------------------------
app.post("/contacts/check", async (req, res) => {
  try {
    let { phones } = req.body;

    if (!phones || !Array.isArray(phones)) {
      return res.status(400).json({ error: "phones array required" });
    }

    phones = phones.map(p =>
      p.replace(/\s+/g, "").replace(/^\+/, "")
    );

    const result = await pool.query(
      `
      SELECT id, phone, public_key
      FROM users
      WHERE REPLACE(REPLACE(phone, '+', ''), ' ', '') = ANY($1)
      `,
      [phones]
    );

    return res.json({ users: result.rows });

  } catch (err) {
    console.error("CONTACTS CHECK ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------------
// CONTACTS — SYNC COMPLETO (per WinkWink)
// ------------------------------------------------------------
app.post("/contacts/sync", async (req, res) => {
  try {
    let { phones, userId } = req.body;

    if (!phones || !Array.isArray(phones))
      return res.status(400).json({ error: "phones array required" });

    if (!userId)
      return res.status(400).json({ error: "userId required" });

    // Normalizzazione numeri
    phones = phones.map(p =>
      p.replace(/\s+/g, "").replace(/^\+/, "")
    );

    // 1️⃣ Trova utenti WinkWink
    const wwResult = await pool.query(
      `
      SELECT
        id AS "userId",
        name AS "name",
        last_name AS "lastName",
        phone,
        public_key AS "publicKey",
        qr_data AS "qrData",
        peer_id AS "peerId",
        fingerprint,
        version
      FROM users
      WHERE REPLACE(REPLACE(phone, '+', ''), ' ', '') = ANY($1)
      `,
      [phones]
    );
    const wwContacts = wwResult.rows; 

    // 2️⃣ Chat dell’utente loggato
    const chatResult = await pool.query(
      `
      SELECT
        c.id AS chat_id,
        CASE
          WHEN c.user1 = $1 THEN c.user2
          ELSE c.user1
        END AS other_id,
        u.name AS other_name,
        (
          SELECT content
          FROM chat_messages
          WHERE chat_id = c.id
          ORDER BY created_at DESC
          LIMIT 1
        ) AS last_message
      FROM chats c
      JOIN users u
        ON u.id = CASE
                    WHEN c.user1 = $1 THEN c.user2
                    ELSE c.user1
                  END
      WHERE c.user1= $1 OR c.user2 = $1
      `,
      [userId]
    );

    // 3️⃣ Contatti non-WW con nome originale
    const allContacts = phones.map(p => ({
      phone: "+" + p,
      name: req.body.originalNames?.[p] ?? ""   // ⭐ nome vero
    }));

    return res.json({
      all_contacts: allContacts,
      ww_contacts: wwContacts,
      chats: chatResult.rows,
      current_user: { id: userId }
    });

  } catch (err) {
    console.error("CONTACTS SYNC ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}); // Questa chiude app.post("/contacts/sync")
// ------------------------------------------------------------
// ROOT + SERVER START
// ------------------------------------------------------------
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("Backend WinkWink attivo");
});

// ------------------------------------------------------------
// ⭐ WEBSOCKET SERVER (Presence + Messaging + Signaling)
// ------------------------------------------------------------

// Creiamo un server HTTP che ingloba Express
const httpServer = createServer(app);

// Inizializziamo Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Mappa presenza: userId → socketId
const onlineUsers = new Map();

// Mappa chat: chatId → Set(socketId)
const chatRooms = new Map();

io.on("connection", (socket) => {
  console.log("🔌 Nuova connessione WebSocket:", socket.id);

  // ------------------------------------------------------------
  // REGISTRAZIONE UTENTE (PRESENZA)
  // ------------------------------------------------------------
  socket.on("register", (userId) => {
    socket.userId = userId;
    onlineUsers.set(userId, socket.id);

    console.log(`🟢 Utente ${userId} online`);

    io.emit("user_online", { userId });
  });

  // ------------------------------------------------------------
  // ENTRA IN UNA CHAT
  // ------------------------------------------------------------
  socket.on("enter_chat", ({ chat_id, user_id }) => {
    if (!chatRooms.has(chat_id)) {
      chatRooms.set(chat_id, new Set());
    }

    chatRooms.get(chat_id).add(socket.id);
    socket.join(`chat_${chat_id}`);

    io.to(socket.id).emit("chat_joined", { chat_id });
    io.emit("user_in_chat", { chat_id, user_id });

    console.log(`💬 Utente ${user_id} è entrato nella chat ${chat_id}`);
  });

  // ------------------------------------------------------------
  // ESCI DA UNA CHAT
  // ------------------------------------------------------------
  socket.on("leave_chat", ({ chat_id, user_id }) => {
    if (chatRooms.has(chat_id)) {
      chatRooms.get(chat_id).delete(socket.id);

      if (chatRooms.get(chat_id).size === 0) {
        chatRooms.delete(chat_id);
      }
    }

    socket.leave(`chat_${chat_id}`);

    console.log(`↩️ Utente ${user_id} ha lasciato la chat ${chat_id}`);
  });

  // ------------------------------------------------------------
  // MESSAGGI REALTIME (CON SALVATAGGIO DB)
  // ------------------------------------------------------------
  socket.on("send_message", async ({ chat_id, message }) => {
    try {
      const result = await pool.query(
        `INSERT INTO chat_messages (chat_id, sender_id, content, created_at)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [chat_id, message.sender_id, message.content, message.created_at]
      );

      const saved = result.rows[0];

      io.to(`chat_${chat_id}`).emit("new_message", {
        chat_id,
        sender_id: saved.sender_id,
        content: saved.content,
        created_at: saved.created_at
      });

      console.log(`📩 Messaggio inoltrato nella chat ${chat_id}`);
    } catch (err) {
      console.error("❌ Errore salvataggio messaggio:", err);
    }
  });

  // ------------------------------------------------------------
  // SIGNALING WEBRTC
  // ------------------------------------------------------------
  socket.on("offer", ({ toUserId, offer }) => {
    const target = onlineUsers.get(toUserId);
    if (target) {
      io.to(target).emit("offer", { from: socket.userId, offer });
      console.log(`📡 Offer da ${socket.userId} a ${toUserId}`);
    }
  });

  socket.on("answer", ({ toUserId, answer }) => {
    const target = onlineUsers.get(toUserId);
    if (target) {
      io.to(target).emit("answer", { from: socket.userId, answer });
      console.log(`📡 Answer da ${socket.userId} a ${toUserId}`);
    }
  });

  socket.on("ice_candidate", ({ toUserId, candidate }) => {
    const target = onlineUsers.get(toUserId);
    if (target) {
      io.to(target).emit("ice_candidate", { from: socket.userId, candidate });
      console.log(`❄️ ICE Candidate da ${socket.userId} a ${toUserId}`);
    }
  });

  // ------------------------------------------------------------
  // DISCONNESSIONE
  // ------------------------------------------------------------
  socket.on("disconnect", () => {
    const userId = socket.userId;

    if (userId) {
      onlineUsers.delete(userId);
      io.emit("user_offline", { userId });

      console.log(`🔴 Utente ${userId} offline`);
    }

    for (const [chatId, sockets] of chatRooms.entries()) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        chatRooms.delete(chatId);
      }
    }
  });
});

// ------------------------------------------------------------
// AVVIO SERVER HTTP + WEBSOCKET
// ------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`🚀 Server + WebSocket attivi su porta ${PORT}`);
});
