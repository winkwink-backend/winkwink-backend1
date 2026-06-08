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

// Garantisce la cartella uploads
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage: salva il file usando il sessionId come nome
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
    if (!token) {
        console.log("📂 [FCM] Nessun token per utente", userId);
        return;
    }

    await sendFCM({
        token,
        data,
        notification: {
            title: "WinkWink",
            body: data.type === "incoming_file"
                ? `${data.senderName} ti ha inviato un file`
                : "Aggiornamento file",
        },
        android: { priority: "high" }
    });
}

/* ---------------------------------------------------------
   1) CREAZIONE SESSIONE + UPLOAD FILE
--------------------------------------------------------- */
router.post("/p2p/session/create/:sessionId", upload.single("file"), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

        if (!from_user_id || !to_user_id || !fileSize || !fileType) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Parametri mancanti" });
        }

        // Salva sessione
        const result = await pool.query(
            `INSERT INTO p2p_sessions
            (session_id, from_user_id, to_user_id, file_size, file_type, file_name, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'uploaded')
            RETURNING *`,
            [sessionId, from_user_id, to_user_id, fileSize, fileType, fileName ?? ""]
        );

        // Nome mittente
        const senderRes = await pool.query(
            "SELECT name FROM users WHERE id = $1",
            [from_user_id]
        );
        const senderName = senderRes.rows[0]?.name ?? "";

        // Payload FCM
        const data = {
            type: "incoming_file",
            sessionId: String(sessionId),
            senderId: String(from_user_id),
            senderName,
            fileName: fileName ? String(fileName) : "file_segreto",
            fileType: String(fileType),
            fileSize: String(fileSize)
        };

        // Notifica push
        await sendFcmToUser(to_user_id, data);

        return res.json({
            session: result.rows[0],
            delivered: "fcm",
            status: "file_stored_on_server"
        });
    } catch (err) {
        console.error("❌ /p2p/session/create:", err.message);
        if (req.file) {
            try { fs.unlinkSync(req.file.path); } catch (e) {}
        }
        return res.status(500).json({ error: err.message });
    }
});

/* ---------------------------------------------------------
   2) ACCEPT → restituisce downloadUrl
--------------------------------------------------------- */
router.post("/p2p/session/accept", async (req, res) => {
    try {
        const sessionId = req.body.sessionId || req.body.sessionid;
        const userId = req.body.userId || req.body.userid;

        if (!sessionId || !userId) {
            return res.status(400).json({ error: "Parametri mancanti" });
        }

        const session = await getSession(sessionId);
        if (!session) return res.status(404).json({ error: "Sessione non trovata" });

        if (String(session.to_user_id) !== String(userId)) {
            return res.status(403).json({ error: "Non autorizzato" });
        }

        await updateSessionStatus(sessionId, "accepted");

        const downloadUrl = `/p2p/session/download/${sessionId}`;

        return res.json({
            status: "ok",
            downloadUrl,
            fileName: session.file_name
        });
    } catch (err) {
        console.error("❌ [ACCEPT][HTTP] Errore interno:", err);
        return res.status(500).json({ error: err.message });
    }
});

/* ---------------------------------------------------------
   3) REJECT → elimina file + notifica mittente
--------------------------------------------------------- */
router.post("/p2p/session/reject", async (req, res) => {
    try {
        const sessionId = req.body.sessionId || req.body.sessionid;
        const userId = req.body.userId || req.body.userid;

        if (!sessionId || !userId) {
            return res.status(400).json({ error: "Parametri mancanti" });
        }

        const session = await getSession(sessionId);
        if (!session) return res.status(404).json({ error: "Sessione non trovata" });

        await updateSessionStatus(sessionId, "rejected");

        const filePath = path.join(uploadDir, String(sessionId));
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        const receiverRes = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
        const receiverName = receiverRes.rows[0]?.name ?? "Il destinatario";

        await sendFcmToUser(session.from_user_id, {
            type: "file_rejected_alert",
            sessionId: String(sessionId),
            message: `Il file è stato rifiutato da ${receiverName}.`
        });

        return res.json({ status: "ok" });
    } catch (err) {
        console.error("❌ [REJECT][HTTP] Errore interno:", err);
        return res.status(500).json({ error: err.message });
    }
});

/* ---------------------------------------------------------
   4) DOWNLOAD → serve file + cleanup + FCM "file_downloaded"
--------------------------------------------------------- */
router.get("/p2p/session/download/:sessionId", async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await getSession(sessionId);
        if (!session) return res.status(404).send("Sessione non trovata");

        const filePath = path.join(uploadDir, String(sessionId));
        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File non disponibile");
        }

        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${session.file_name}"`);
        res.setHeader('Content-Length', String(session.file_size));

        res.sendFile(filePath, async (err) => {
            if (!err) {
                await updateSessionStatus(sessionId, "completed");

                // Notifica al mittente
                await sendFcmToUser(session.from_user_id, {
                    type: "file_downloaded",
                    sessionId: String(sessionId),
                    senderName: session.file_name,
                    route: "/download_center"
                });

                // Cleanup
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
        });
    } catch (err) {
        console.error("❌ /p2p/session/download:", err.message);
        return res.status(500).send("Errore interno");
    }
});

/* ---------------------------------------------------------
   5) GET SESSION
--------------------------------------------------------- */
router.get("/p2p/session/:sessionId", async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await getSession(sessionId);
        if (!session) return res.status(404).json({ error: "Session not found" });
        return res.json({ session });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

export default router;
