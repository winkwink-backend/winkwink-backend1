import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import pool from "./db.js";
import admin from "./firebase-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Configurazione dello storage per i file criptati temporanei (Nome file = sessionId)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${req.params.sessionId}.enc`);
  }
});
const upload = multer({ storage: storage });

// ------------------------------------------------------------
// ⭐ FOLDER RESPONSE (mittente ↔ ricevente)
// ------------------------------------------------------------
global.folderResponses = global.folderResponses || {};

router.post("/p2p/session/folder_response", async (req, res) => {
  const { sessionId, status, error } = req.body;
  console.log("📂 [BACKEND] POST folder_response ARRIVATO:", req.body);
  global.folderResponses[sessionId] = { status, error };
  return res.json({ ok: true });
});

router.get("/p2p/session/folder_response/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;
  const resp = global.folderResponses[sessionId];
  console.log("📂 [BACKEND] GET folder_response:", sessionId, resp);
  if (!resp) {
    return res.json({});
  }
  return res.json(resp);
});

// ------------------------------------------------------------
// ⭐ CHECK FOLDER (mittente → server)
// ------------------------------------------------------------
router.post("/p2p/session/check_folder", async (req, res) => {
  const { sessionId, path } = req.body;
  console.log("📂 [BACKEND] POST check_folder ARRIVATO:", req.body);
  return res.json({ ok: true });
});

// ------------------------------------------------------------
// ⭐ LATO MITTENTE: CARICAMENTO DEL FILE SUL PONTE
// ------------------------------------------------------------
router.post("/p2p/upload-ponte/:sessionId", upload.single("file"), (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    console.log(`📦 [SERVER PONTE] File criptato ricevuto per sessione: ${sessionId}`);
    return res.status(200).json({ 
      status: "ready_for_download",
      sessionId: sessionId 
    });
  } catch (error) {
    console.error("❌ Errore durante l'upload del file ponte:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ------------------------------------------------------------
// ⭐ LATO RICEVENTE: SCARICAMENTO E DISTRUZIONE IMMEDIATA
// ------------------------------------------------------------
router.get("/p2p/download-ponte/:sessionId", (req, res) => {
  const sessionId = req.params.sessionId;
  const filePath = path.join(__dirname, "uploads", `${sessionId}.enc`);

  if (!fs.existsSync(filePath)) {
    console.log(`❌ [SERVER PONTE] Download fallito: file non trovato per sessione ${sessionId}`);
    return res.status(404).send("File non trovato o gia' scaricato.");
  }

  console.log(`🛰️ [SERVER PONTE] Avvio streaming del file per sessione: ${sessionId}...`);

  res.download(filePath, `${sessionId}.enc`, (err) => {
    if (err) {
      console.error(`❌ Errore durante lo streaming del file ${sessionId}:`, err);
    } else {
      console.log(`✅ [SERVER PONTE] Download ultimato con successo per sessione: ${sessionId}`);
      
      // Rimozione fisica istantanea dal disco rigido per garantire la totale privacy
      fs.unlink(filePath, (unlinkErr) => {
        if (unlinkErr) {
          console.error(`❌ Errore cancellazione fisica del file temporaneo (${sessionId}.enc):`, unlinkErr);
        } else {
          console.log(`🗑️ [PRIVACY COMPLETED] File temporaneo ${sessionId}.enc eliminato definitivamente dal server.`);
        }
      });
    }
  });
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

    const result = await pool.query(
      `INSERT INTO p2p_sessions (session_id, from_user_id, to_user_id, file_size, file_type, file_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [sessionId, from_user_id, to_user_id, fileSize, fileType, fileName ?? ""]
    );

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

    const receiver = await pool.query(
      "SELECT fcm_token FROM users WHERE id = $1",
      [to_user_id]
    );
    const token = receiver.rows[0]?.fcm_token;
    if (token) {
      const sender = await pool.query(
        "SELECT name FROM users WHERE id = $1",
        [from_user_id]
      );
      const senderName = sender.rows[0]?.name ?? "";

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
      console.log(`📂 incoming_file via FCM → utente ${to_user_id}`);
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
