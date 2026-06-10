// p2p_http_handlers.js
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
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer: salva file con nome = sessionId
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${req.params.sessionId}`),
});
const upload = multer({ storage });

// Helpers
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
    if (!token) return;
    await sendFCM({ token, data });
}

/* ---------------------------------------------------------
   1) CREAZIONE SESSIONE + UPLOAD FILE  ⭐ PATCH COMPLETA
--------------------------------------------------------- */
router.post("/p2p/session/create/:sessionId", upload.single("file"), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

        if (!from_user_id || !to_user_id || !fileSize || !fileType) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Parametri mancanti" });
        }

        const result = await pool.query(
            `INSERT INTO p2p_sessions
            (session_id, from_user_id, to_user_id, file_size, file_type, file_name, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'uploaded')
            RETURNING *`,
            [sessionId, from_user_id, to_user_id, fileSize, fileType, fileName ?? ""]
        );

        // 1️⃣ Notifica iniziale
        // FLUSSO B (APP APERTA → P2P)
        // Invia SOLO incoming_file
        await sendFcmToUser(to_user_id, {
            type: "incoming_file",
            sessionId,
            senderId: String(from_user_id),
            fileName: fileName ?? "file",
            fileType,
            fileSize: String(fileSize)
        });


        return res.json({
            session: result.rows[0],
            delivered: "fcm",
            status: "file_stored_on_server"
        });

    } catch (err) {
        if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(500).json({ error: err.message });
    }
});

/* ---------------------------------------------------------
   2) ACCEPT → restituisce downloadUrl
--------------------------------------------------------- */
router.post("/p2p/session/accept", async (req, res) => {
    try {
        const sessionId = req.body.sessionId;
        const userId = req.body.userId;

        const session = await getSession(sessionId);
        if (!session) return res.status(404).json({ error: "Sessione non trovata" });

        await updateSessionStatus(sessionId, "accepted");

        return res.json({
            status: "ok",
            downloadUrl: `/p2p/session/download/${sessionId}`,
            fileName: session.file_name
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/* ---------------------------------------------------------
   3) REJECT
--------------------------------------------------------- */
router.post("/p2p/session/reject", async (req, res) => {
    try {
        const sessionId = req.body.sessionId;
        const userId = req.body.userId;

        const session = await getSession(sessionId);
        if (!session) return res.status(404).json({ error: "Sessione non trovata" });

        await updateSessionStatus(sessionId, "rejected");

        const filePath = path.join(uploadDir, String(sessionId));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        await sendFcmToUser(session.from_user_id, {
            type: "file_rejected_alert",
            sessionId
        });

        return res.json({ status: "ok" });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

/* ---------------------------------------------------------
   4) DOWNLOAD
--------------------------------------------------------- */
router.get("/p2p/session/download/:sessionId", async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await getSession(sessionId);
        if (!session) return res.status(404).send("Sessione non trovata");

        const filePath = path.join(uploadDir, String(sessionId));
        if (!fs.existsSync(filePath)) return res.status(404).send("File non disponibile");

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${session.file_name}"`);
        res.setHeader("Content-Length", String(session.file_size));

        res.sendFile(filePath, async (err) => {
            if (!err) {
                await updateSessionStatus(sessionId, "completed");
                try { fs.unlinkSync(filePath); } catch {}
            }
        });
    } catch (err) {
        return res.status(500).send("Errore interno");
    }
});

export default router;
