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

// Garantisce l'esistenza della cartella uploads sul server
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configurazione dello storage: rinomina il file usando direttamente il sessionId unico
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
        console.log("📂 [FCM] Nessun token per utente", userId);
        return;
    }
    await sendFCM({ token, data });
}

// 1) CREAZIONE SESSIONE E CARICAMENTO FILE FISICO SUL SERVER
router.post("/p2p/session/create/:sessionId", upload.single("file"), async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { from_user_id, to_user_id, fileSize, fileType, fileName } = req.body;

        if (!from_user_id || !to_user_id || !fileSize || !fileType) {
            // Se l'upload è fallito o i parametri mancano, pulisce l'eventuale file scritto
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Parametri mancanti" });
        }

        // Inserisce la sessione nello stato 'uploaded' poiché il file è fisicamente sul server
        const result = await pool.query(
            `INSERT INTO p2p_sessions
            (session_id, from_user_id, to_user_id, file_size, file_type, file_name, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'uploaded')
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
            senderId: String(from_user_id),
            senderName,
            fileName: fileName ? String(fileName) : "file_segreto",
            fileType: String(fileType),
            fileSize: String(fileSize)
        };

        // Sveglia il destinatario in background tramite notifica push ad alta priorità
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

// 2) ACCETTAZIONE DA NOTIFICA BACKGROUND (Mantenuto per compatibilità di tracciamento log)
router.post("/p2p/session/accept", async (req, res) => {
    try {
        console.log("📂 [ACCEPT][HTTP] Richiesta ricevuta:", req.body);
        const sessionId = req.body.sessionId || req.body.sessionid;
        const userId = req.body.userId || req.body.userid;

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
        return res.json({ status: "ok", message: "Sessione pronta per il download nativo" });
    } catch (err) {
        console.error("❌ [ACCEPT][HTTP] Errore interno:", err);
        return res.status(500).json({ error: err.message });
    }
});

// 3) RIFIUTO DA NOTIFICA BACKGROUND: RIMOZIONE FILE DAL DISCO E NOTIFICA AL MITTENTE
router.post("/p2p/session/reject", async (req, res) => {
    try {
        console.log("📂 [REJECT][HTTP] Richiesta ricevuta:", req.body);
        const sessionId = req.body.sessionId || req.body.sessionid;
        const userId = req.body.userId || req.body.userid;

        if (!sessionId || !userId) {
            return res.status(400).json({ error: "Parametri mancanti" });
        }

        const session = await getSession(sessionId);
        if (!session) {
            return res.status(404).json({ error: "Sessione non trovata" });
        }

        // Cambia lo stato sul DB
        await updateSessionStatus(sessionId, "rejected");

        // Rimozione fisica del file memorizzato per liberare spazio su disco
        const filePath = path.join(uploadDir, String(sessionId));
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🧹 [CLEANUP] File rimosso a seguito di rifiuto per sessione: ${sessionId}`);
        }

        // Recupera le informazioni del ricevente che ha eseguito il rifiuto
        const receiverRes = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
        const receiverName = receiverRes.rows[0]?.name ?? "Il destinatario";

        // Manda una notifica Push FCM al mittente originario avvisandolo del rifiuto ad app chiusa
        const fcmPayload = {
            type: "file_rejected_alert",
            sessionId: String(sessionId),
            message: `Il file è stato rifiutato. L'utente ${receiverName} aveva l'app chiusa.`
        };

        await sendFcmToUser(session.from_user_id, fcmPayload);

        return res.json({ status: "ok", message: "Rifiuto elaborato e file eliminato dal server" });
    } catch (err) {
        console.error("❌ [REJECT][HTTP] Errore interno:", err);
        return res.status(500).json({ error: err.message });
    }
});

// 4) DOWNLOAD STATICO DIRETTO PER ANDROID DOWNLOADMANAGER
router.get("/p2p/session/download/:sessionId", async (req, res) => {
    try {
        const { sessionId } = req.params;
        console.log(`📂 [DOWNLOAD][HTTP] Richiesta file statico per sessione: ${sessionId}`);

        const session = await getSession(sessionId);
        if (!session) {
            return res.status(404).send("Sessione non trovata");
        }

        const filePath = path.join(uploadDir, String(sessionId));
        if (!fs.existsSync(filePath)) {
            return res.status(404).send("File non disponibile sul server o già rimosso");
        }

        // Configurazione delle intestazioni HTTP per istruire l'Android DownloadManager nativo
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${session.file_name || 'winkwink_file'}"`);
        res.setHeader('Content-Length', String(session.file_size));

        // Invia il file statico memorizzato sul server
        res.sendFile(filePath, async (err) => {
            if (!err) {
                console.log(`✅ [DOWNLOAD][HTTP] File trasmesso interamente per sessione: ${sessionId}`);
                await updateSessionStatus(sessionId, "completed");
                
                // Opzionale: Rimuove il file dal server dopo il primo download riuscito per privacy
                try { fs.unlinkSync(filePath); } catch (e) {}
            }
        });
    } catch (err) {
        console.error("❌ /p2p/session/download:", err.message);
        return res.status(500).send("Errore interno di download");
    }
});

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
