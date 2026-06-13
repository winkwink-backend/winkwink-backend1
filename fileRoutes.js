import express from "express";
import multer from "multer";
import path from "path";
import pool from "./db.js";
import { sendFCM } from "./firebase-config.js";

const router = express.Router();

// ======================================================
// 📁 CONFIGURAZIONE MULTER (upload su /uploads)
// ======================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "_" + Math.floor(Math.random() * 999999);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// ======================================================
// ⭐ UPLOAD HTTP — FLUSSO UFFICIALE 2026
// ======================================================
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const {
      from_user_id,
      to_user_id,
      fileType,
      fileSize,
      fileName,
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "File mancante" });
    }

    if (!from_user_id || !to_user_id || !fileType || !fileName) {
      return res.status(400).json({ error: "Parametri mancanti" });
    }

    const savedFileName = req.file.filename;
    const downloadUrl = `${process.env.BASE_URL}/uploads/${savedFileName}`;

    console.log("📥 File ricevuto:", {
      from_user_id,
      to_user_id,
      fileType,
      fileSize,
      fileName,
      savedFileName,
      downloadUrl,
    });

    // ======================================================
    // 1️⃣ Salva pending file nel DB
    // ======================================================
    await pool.query(
      `
      INSERT INTO pending_files 
      (from_user_id, to_user_id, file_name, file_type, file_size, download_url, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
      [
        from_user_id,
        to_user_id,
        fileName,
        fileType,
        fileSize || 0,
        downloadUrl,
      ]
    );

    // ======================================================
    // 2️⃣ Recupera token FCM del destinatario
    // ======================================================
    const tokenRes = await pool.query(
      "SELECT fcm_token FROM users WHERE id = $1",
      [to_user_id]
    );

    const token = tokenRes.rows[0]?.fcm_token;

    // ======================================================
    // 3️⃣ Invia PUSH SILENZIOSA al destinatario
    // ======================================================
    if (token) {
      console.log("📡 Invio push silenziosa al destinatario...");

      await sendFCM({
        token,
        data: {
          type: "new_pending_file",
          fileName,
          fileType,
          fileSize: String(fileSize || 0),
          downloadUrl,
          fromUserId: String(from_user_id),
        },
      });
    } else {
      console.log("⚠️ Nessun token FCM per il destinatario");
    }

    // ======================================================
    // 4️⃣ Risposta HTTP
    // ======================================================
    res.json({
      success: true,
      downloadUrl,
    });

  } catch (err) {
    console.error("❌ Errore upload:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// ⭐ Recupera pending files per un utente
// ======================================================
router.get("/pending/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT * FROM pending_files
      WHERE to_user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// ⭐ Svuota pending files (dopo download)
// ======================================================
router.post("/pending/clear", async (req, res) => {
  const { userId } = req.body;

  try {
    await pool.query(
      "DELETE FROM pending_files WHERE to_user_id = $1",
      [userId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
