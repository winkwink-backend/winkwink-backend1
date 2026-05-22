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
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${req.params.sessionId}`),
});
const upload = multer({ storage });

async function getSession(sessionId) {
  const result = await pool.query(
    "SELECT * FROM p2p_sessions WHERE session_id = $1",
    [sessionId]
  );
  return result.rows[0] || null;
}

async function updateSessionStatus(sessionId, status) {
  await pool.query(
    "UPDATE p2p_sessions SET status = $1, updated_at = NOW() WHERE session_id = $2",
    [status, sessionId]
  );
}

async function sendFcmToUser(userId, data) {
  const res = await pool.query(
    "SELECT fcm_token FROM users WHERE id = $1",
    [userId]
  );
  const token = res.rows[0]?.fcm_token;
  if (!token) {
    console.log("⚠️ [FCM] Nessun token per utente", userId);
    return;
  }
  await sendFCM({ token, data });
}

// 1) CREA SESSIONE
router.post("/p2p/session/create", async (req, res) => {
  try {
    const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

    if (!from_user_id || !to_user_id || !fileSize || !fileType) {
      return res.status(400).json({ error: "Parametri mancanti" });
    }

    const sessionId = String(Date.now());

    const result = await pool.query(
      `INSERT INTO p2p_sessions
       (session_id, from_user_id, to_user_id, file_size, file_type, file_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
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

    const senderRes = await pool.query(
      "SELECT name FROM users WHERE id = $1",
      [from_user_id]
    );
    const senderName = senderRes.rows[0]?.name ?? "";

    const data = {
      type: "incoming_file",
      sessionId: String(sessionId),
      fromUserId: String(from_user_id),
      senderName,
      fileName: fileName ? String(fileName) : "",
      fileType: fileType ? String(fileType) : "",
      fileSize: fileSize ? String(fileSize) : "0",
    };

    await sendFcmToUser(to_user_id, data);

    return res.json({
      session: result.rows[0],
      delivered: "fcm",
      i18n_key: "file_transfer_waiting_accept",
    });
  } catch (err) {
    console.error("❌ /p2p/session/create:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 2) ACCETTAZIONE
router.post("/p2p/session/accept", async (req, res) => {
  try {
    const { sessionId, userId } = req.body;

    if (!sessionId || !userId) {
      return res.status(400).json({ error: "Parametri mancanti" });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }

    if (String(session.to_user_id) !== String(userId)) {
      return res.status(403).json({ error: "Non autorizzato" });
    }

    await updateSessionStatus(sessionId, "accepted");

    const uploadUrl = `/p2p/session/upload/${sessionId}`;

    return res.json({
      status: "ok",
      uploadUrl,
    });
  } catch (err) {
    console.error("❌ /p2p/session/accept:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// 3) UPLOAD FILE
router.post(
  "/p2p/session/upload/:sessionId",
  upload.single("file"),
  async (req, res) => {
    try {
      const { sessionId } = req.params;

      const session = await getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Sessione non trovata" });
      }

      if (session.status !== "accepted") {
        return res.status(400).json({ error: "Sessione non accettata" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "File mancante" });
      }

      await updateSessionStatus(sessionId, "uploaded");

      const downloadUrl = `/p2p/session/download/${sessionId}`;

      const data = {
        type: "file_ready",
        sessionId: String(sessionId),
        fileName: session.file_name ?? "",
        fileType: session.file_type ?? "",
        fileSize: String(session.file_size ?? "0"),
        downloadUrl,
        fromUserId: String(session.from_user_id),
      };

      await sendFcmToUser(session.to_user_id, data);

      return res.json({
        status: "ready_for_download",
        sessionId,
        downloadUrl,
      });
    } catch (err) {
      console.error("❌ /p2p/session/upload:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }
);

// 4) DOWNLOAD FILE
router.get("/p2p/session/download/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).send("Sessione non trovata");
    }

    const filePath = path.join(uploadDir, `${sessionId}`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File non trovato");
    }

    res.download(filePath, session.file_name || `winkwink_${sessionId}`, (err) => {
      if (err) {
        console.error("❌ Errore download:", err);
      } else {
        console.log("✅ Download completato per sessione", sessionId);
      }
    });
  } catch (err) {
    console.error("❌ /p2p/session/download:", err.message);
    return res.status(500).send("Errore interno");
  }
});

// 5) DOWNLOAD COMPLETATO + DELETE
router.post("/p2p/session/downloadCompleted", async (req, res) => {
  try {
    const { sessionId, userId } = req.body;

    if (!sessionId || !userId) {
      return res.status(400).json({ error: "Parametri mancanti" });
    }

    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }

    if (String(session.to_user_id) !== String(userId)) {
      return res.status(403).json({ error: "Non autorizzato" });
    }

    await updateSessionStatus(sessionId, "completed");

    const filePath = path.join(uploadDir, `${sessionId}`);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error("❌ Errore cancellazione file:", err);
        } else {
          console.log("🗑️ File temporaneo eliminato per sessione", sessionId);
        }
      });
    }

    return res.json({ status: "ok" });
  } catch (err) {
    console.error("❌ /p2p/session/downloadCompleted:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// opzionale: GET sessione
router.get("/p2p/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    return res.json({ session });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
