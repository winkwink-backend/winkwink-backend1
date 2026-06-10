// p2pRoutes.js — VERSIONE DEFINITIVA (volume Railway + file_path)
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import pool from "./db.js";
import { sendFCM } from "./firebase-config.js";

const router = express.Router();

/* ---------------------------------------------------------
 VOLUME PERSISTENTE RAILWAY
--------------------------------------------------------- */
const uploadDir = "/app/uploads";

if (!fs.existsSync(uploadDir)) {
  console.log("📁 [INIT] Creo cartella volume:", uploadDir);
  fs.mkdirSync(uploadDir, { recursive: true });
} else {
  console.log("📁 [INIT] Volume già presente:", uploadDir);
}

/* ---------------------------------------------------------
 MULTER → salva i file nel volume
--------------------------------------------------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log("📥 [MULTER] Salvataggio file in:", uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const finalName = unique + ext;

    console.log("📥 [MULTER] Nome file:", finalName);
    cb(null, finalName);
  },
});

const upload = multer({ storage });

/* ---------------------------------------------------------
 HELPERS
--------------------------------------------------------- */
async function getSession(sessionId) {
  const result = await pool.query(
    "SELECT * FROM p2p_sessions WHERE session_id = $1",
    [sessionId]
  );
  return result.rows[0] || null;
}

async function updateSessionStatus(sessionId, status) {
  await pool.query(
    "UPDATE p2p_sessions SET status=$1, updated_at=NOW() WHERE session_id=$2",
    [status, sessionId]
  );
}

async function sendFcmToUser(userId, data) {
  const res = await pool.query(
    "SELECT fcm_token FROM users WHERE id=$1",
    [userId]
  );
  const token = res.rows[0]?.fcm_token;

  if (!token) return;

  await sendFCM({
    token,
    data,
    android: { priority: "high" },
  });
}

/* ---------------------------------------------------------
 0) INIT SESSION
--------------------------------------------------------- */
router.post("/p2p/session/init", async (req, res) => {
  try {
    const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

    const sessionId = Date.now().toString();

    await pool.query(
      `INSERT INTO p2p_sessions
       (session_id, from_user_id, to_user_id, file_size, file_type, file_name, status)
       VALUES ($1,$2,$3,$4,$5,$6,'init')`,
      [sessionId, from_user_id, to_user_id, fileSize, fileType, fileName ?? ""]
    );

    res.json({ sessionId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
 1) UPLOAD FILE → SALVA file_path NEL DB
--------------------------------------------------------- */
router.post(
  "/p2p/session/create/:sessionId",
  upload.single("file"),
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "File mancante" });
      }

      const savedPath = req.file.path;

      const result = await pool.query(
        `UPDATE p2p_sessions
         SET file_size=$1,
             file_type=$2,
             file_name=$3,
             file_path=$4,
             status='uploaded',
             updated_at=NOW()
         WHERE session_id=$5
         RETURNING *`,
        [fileSize, fileType, fileName ?? "", savedPath, sessionId]
      );

      const sessionData = result.rows[0];

      await sendFcmToUser(to_user_id, {
        type: "file_ready_for_download",
        sessionId,
        fileName: sessionData.file_name,
        fileType,
        fileSize: String(fileSize),
        downloadUrl: `/p2p/session/download/${sessionId}`,
        senderId: String(from_user_id),
      });

      res.json({
        session: sessionData,
        delivered: "fcm",
        status: "file_stored_on_server",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* ---------------------------------------------------------
 2) DOWNLOAD FILE DAL VOLUME
--------------------------------------------------------- */
router.get("/p2p/session/download/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await getSession(sessionId);
    if (!session) return res.status(404).send("Sessione non trovata");

    const filePath = session.file_path;

    if (!filePath || !fs.existsSync(filePath)) {
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
      await updateSessionStatus(sessionId, "completed");

      await sendFcmToUser(session.from_user_id, {
        type: "file_downloaded",
        sessionId,
      });
    });
  } catch (err) {
    res.status(500).send("Errore interno");
  }
});

export default router;
