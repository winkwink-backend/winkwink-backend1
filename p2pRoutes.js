// p2pRoutes.js (HTTP FALLBACK) — VERSIONE PATCHATA + LOG COMPLETI
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import pool from "./db.js";
import { sendFCM } from "./firebase-config.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, "uploads");

// Garantisce cartella uploads
if (!fs.existsSync(uploadDir)) {
  console.log("📁 [INIT] Creo cartella uploads:", uploadDir);
  fs.mkdirSync(uploadDir, { recursive: true });
} else {
  console.log("📁 [INIT] Cartella uploads esiste:", uploadDir);
}

// Multer: salva file con nome = sessionId
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log("📥 [MULTER] Salvataggio file in:", uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    console.log("📥 [MULTER] Nome file assegnato:", req.params.sessionId);
    cb(null, `${req.params.sessionId}`);
  },
});
const upload = multer({ storage });

// Helpers
async function getSession(sessionId) {
  console.log("🔍 [DB] Recupero sessione:", sessionId);
  const result = await pool.query(
    "SELECT * FROM p2p_sessions WHERE session_id = $1",
    [sessionId]
  );
  return result.rows[0] || null;
}

async function updateSessionStatus(sessionId, status) {
  console.log(`📝 [DB] Aggiorno sessione ${sessionId} → ${status}`);
  await pool.query(
    "UPDATE p2p_sessions SET status = $1, updated_at = NOW() WHERE session_id = $2",
    [status, sessionId]
  );
}

async function sendFcmToUser(userId, data) {
  console.log("📡 [FCM] Invio FCM a user:", userId, "payload:", data);

  const res = await pool.query(
    "SELECT fcm_token FROM users WHERE id = $1",
    [userId]
  );
  const token = res.rows[0]?.fcm_token;

  if (!token) {
    console.log("⚠️ [FCM] Nessun token FCM per user:", userId);
    return;
  }

  await sendFCM({
    token,
    data,
    android: { priority: "high" },
  });

  console.log("✅ [FCM] FCM inviato con successo");
}

/* ---------------------------------------------------------
0) INIT SESSION
--------------------------------------------------------- */
router.post("/p2p/session/init", async (req, res) => {
  console.log("📩 [HTTP] /p2p/session/init", req.body);

  try {
    const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

    if (!from_user_id || !to_user_id || !fileSize || !fileType) {
      console.log("❌ [INIT] Parametri mancanti");
      return res.status(400).json({ error: "Parametri mancanti" });
    }

    const sessionId = Date.now().toString();
    console.log("🆕 [INIT] Creata sessione:", sessionId);

    await pool.query(
      `INSERT INTO p2p_sessions
      (session_id, from_user_id, to_user_id, file_size, file_type, file_name, status)
      VALUES ($1,$2,$3,$4,$5,$6,'init')`,
      [sessionId, from_user_id, to_user_id, fileSize, fileType, fileName ?? ""]
    );

    return res.json({ sessionId });
  } catch (err) {
    console.error("❌ [INIT] Errore:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
1) UPLOAD FILE SU DISCO + PATCH
--------------------------------------------------------- */
router.post("/p2p/session/create/:sessionId", upload.single("file"), async (req, res) => {
  console.log("📩 [HTTP] /p2p/session/create", req.params, req.body);

  try {
    const { sessionId } = req.params;
    const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

    if (!req.file) {
      console.log("❌ [UPLOAD] Nessun file ricevuto da Multer");
      return res.status(400).json({ error: "File mancante" });
    }

    console.log("📦 [UPLOAD] File ricevuto:", req.file.path);

    const realSize = fs.statSync(req.file.path).size;
    console.log("📏 [UPLOAD] Dimensione reale file:", realSize);

    const result = await pool.query(
      `UPDATE p2p_sessions
       SET file_size=$1, file_type=$2, file_name=$3, status='uploaded', updated_at=NOW()
       WHERE session_id=$4
       RETURNING *`,
      [fileSize, fileType, fileName ?? "", sessionId]
    );

    console.log("📝 [DB] Sessione aggiornata:", result.rows[0]);

    // 1️⃣ Notifica iniziale
    await sendFcmToUser(to_user_id, {
      type: "incoming_file",
      sessionId,
      senderId: String(from_user_id),
      fileName: fileName ?? "file",
      fileType,
      fileSize: String(fileSize),
    });

    console.log("📡 [UPLOAD] FCM incoming_file inviato");

    // ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐
    // 2️⃣ PATCH: Notifica con link pronto
    // ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐
    await sendFcmToUser(to_user_id, {
      type: "file_ready_for_download",
      sessionId,
      fileName: fileName ?? "file",
      fileType,
      fileSize: String(fileSize),
      downloadUrl: `/p2p/session/download/${sessionId}`
    });

    console.log("📡 [UPLOAD] FCM file_ready_for_download inviato");
    // ⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐⭐

    return res.json({
      session: result.rows[0],
      delivered: "fcm",
      status: "file_stored_on_server",
    });

  } catch (err) {
    console.error("❌ [UPLOAD] Errore:", err);
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
4) DOWNLOAD DA DISCO
--------------------------------------------------------- */
router.get("/p2p/session/download/:sessionId", async (req, res) => {
  console.log("📩 [HTTP] /p2p/session/download", req.params);

  try {
    const { sessionId } = req.params;

    const session = await getSession(sessionId);
    if (!session) {
      console.log("❌ [DOWNLOAD] Sessione non trovata");
      return res.status(404).send("Sessione non trovata");
    }

    const filePath = path.join(uploadDir, String(sessionId));
    console.log("📁 [DOWNLOAD] File path:", filePath);

    if (!fs.existsSync(filePath)) {
      console.log("❌ [DOWNLOAD] File non disponibile");
      return res.status(404).send("File non disponibile");
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${session.file_name}"`
    );
    res.setHeader("Content-Length", String(session.file_size));

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);

    stream.on("close", async () => {
      console.log("📤 [DOWNLOAD] File inviato, aggiorno DB e cancello file");

      await updateSessionStatus(sessionId, "completed");

      await sendFcmToUser(session.from_user_id, {
        type: "file_downloaded",
        sessionId,
      });

      try {
        //fs.unlinkSync(filePath);
        //console.log("🗑️ [DOWNLOAD] File eliminato dal server");
      } catch (e) {
        console.log("⚠️ [DOWNLOAD] Errore eliminazione file:", e);
      }
    });

  } catch (err) {
    console.error("❌ [DOWNLOAD] Errore:", err);
    return res.status(500).send("Errore interno");
  }
});

export default router;
