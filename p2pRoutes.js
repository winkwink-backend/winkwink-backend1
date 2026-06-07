import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";
import pool from "./db.js";
import { sendFCM } from "./firebase-config.js";
import { PassThrough } from "stream";

const router = express.Router();
const activeStreams = new Map();

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
     senderId: String(from_user_id),  
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
    console.log("📥 [ACCEPT][HTTP] Richiesta ricevuta:", req.body);

    // ⭐ CORREZIONE PARAMETRI: Accetta sia le chiavi minuscole (Nativo) che CamelCase (Flutter)
    const sessionId = req.body.sessionId || req.body.sessionid;
    const userId = req.body.userId || req.body.userid;

    if (!sessionId || !userId) {
      console.log("❌ [ACCEPT][HTTP] Parametri mancanti:", { sessionId, userId });
      return res.status(400).json({ error: "Parametri mancanti" });
    }

    // Recupera sessione
    const session = await getSession(sessionId);
    console.log("📄 [ACCEPT][HTTP] Sessione trovata:", session);

    if (!session) {
      console.log("❌ [ACCEPT][HTTP] Sessione NON trovata:", sessionId);
      return res.status(404).json({ error: "Sessione non trouvata" });
    }

    // Controllo autorizzazione
    console.log("🔍 [ACCEPT][HTTP] Confronto autorizzazione:", {
      session_to_user_id: String(session.to_user_id),
      userId_ricevuto: String(userId),
    });

    if (String(session.to_user_id) !== String(userId)) {
      console.log("⛔ [ACCEPT][HTTP] 403 NON AUTORIZZATO:", {
        session_to_user_id: session.to_user_id,
        userId_ricevuto: userId,
      });
      return res.status(403).json({ error: "Non autorizzato" });
    }

    // Aggiorna stato
    await updateSessionStatus(sessionId, "accepted");
    console.log("✅ [ACCEPT][HTTP] Sessione aggiornata a 'accepted'");

    // Notifica via WebSocket
    const io = req.io;
    const onlineUsers = req.onlineUsers;

    if (!io || !onlineUsers) {
      console.log("⚠️ [ACCEPT][HTTP] io o onlineUsers NON disponibili");
    } else {
      const senderSocketId = onlineUsers.get(String(session.from_user_id));

      console.log("📡 [ACCEPT][HTTP] Mittente onlineUsers.get:", {
        from_user_id: session.from_user_id,
        senderSocketId,
        onlineUsers: Array.from(onlineUsers.entries()),
      });

      if (senderSocketId) {
        // ⭐ NOTA SINCRO FLUTTER: Inviamo toUserId in modo che combaci con il parser del mittente
        io.to(senderSocketId).emit('file_accept', {
            sessionId: session.session_id,
            fromUserId: session.to_user_id,   // Chi ha accettato (User 1)
            toUserId: session.from_user_id    // Il destinatario reale del pacchetto (User 2)
        });

        console.log("📤 [ACCEPT][HTTP] file_accept INVIATO via WS:", {
          sessionId,
          fromUserId: session.from_user_id,
          toUserId: userId,
        });
      } else {
        console.log("⚠️ [ACCEPT][HTTP] Mittente OFFLINE, impossibile inviare WS:", {
          sessionId,
          fromUserId: session.from_user_id,
          toUserId: userId,
        });
      }
    }

    const uploadUrl = `/p2p/session/upload/${sessionId}`;
    console.log("🔗 [ACCEPT][HTTP] Upload URL generato:", uploadUrl);

    return res.json({
      status: "ok",
      uploadUrl,
    });

  } catch (err) {
    console.error("❌ [ACCEPT][HTTP] Errore interno:", err);
    return res.status(500).json({ error: err.message });
  }
});


// ============================================================
// 3) UPLOAD FILE IN STREAMING (PIPE CONCORRENTE)
// ============================================================
// ⭐ NOTA: Abbiamo rimosso 'upload.single("file")' perché leggiamo i byte direttamente dalla richiesta HTTP raw
router.post("/p2p/session/upload/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`📥 [UPLOAD][HTTP] Ricezione byte in streaming per sessione: ${sessionId}`);

    const session = await getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Sessione non trovata" });
    }

    if (session.status !== "accepted") {
      return res.status(400).json({ error: "Sessione non accettata" });
    }

    // Creiamo il tunnel PassThrough in memoria per questa specifica sessione
    const tunnel = new PassThrough();
    activeStreams.set(sessionId, tunnel);

    // Convogliamo i byte in arrivo dal mittente Dart dentro il nostro tunnel di memoria
    req.pipe(tunnel);

    await updateSessionStatus(sessionId, "uploaded");

    req.on('end', () => {
      console.log(`✅ [UPLOAD][HTTP] Il mittente ha terminato l'invio dei byte per: ${sessionId}`);
    });

    // Rispondiamo al mittente solo quando lo stream si chiude (segno che il ricevente ha preso tutto)
    tunnel.on('end', () => {
      console.log(`🧹 [UPLOAD][HTTP] Trasferimento chiuso. Rimuovo lo stream della sessione: ${sessionId}`);
      activeStreams.delete(sessionId);
      return res.json({
        status: "ready_for_download",
        sessionId
      });
    });

  } catch (err) {
    console.error("❌ /p2p/session/upload:", err.message);
    activeStreams.delete(req.params.sessionId);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
// 4) DOWNLOAD FILE IN STREAMING (PIPE CONCORRENTE)
// ============================================================
router.get("/p2p/session/download/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    console.log(`📤 [DOWNLOAD][HTTP] Il ricevente richiede l'aggancio alla sessione: ${sessionId}`);

    const session = await getSession(sessionId);

    if (!session) {
      return res.status(404).send("Sessione non trovata");
    }

    // Recuperiamo il tunnel in memoria in cui il mittente sta iniettando i byte
    const tunnel = activeStreams.get(sessionId);

    if (!tunnel) {
      console.log(`❌ [DOWNLOAD][HTTP] Stream in tempo reale non trovato o scaduto per: ${sessionId}`);
      return res.status(404).send("File in streaming non disponibile o scaduto");
    }

    // ⭐ CONFIGURAZIONE HEADER: Guida il DownloadManager nativo di Android
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${session.file_name || 'winkwink_file'}"`);
    // Passiamo la dimensione reale del file memorizzata nel DB per far mostrare ad Android la percentuale esatta
    res.setHeader('Content-Length', String(session.file_size));

    // Spingiamo i byte del tunnel direttamente dentro la risposta HTTP del DownloadManager di Android
    tunnel.pipe(res);

    res.on('finish', async () => {
      console.log(`✅ [DOWNLOAD][HTTP] Download completato con successo dal ricevente per: ${sessionId}`);
      
      // Aggiorna lo stato nel database
      await updateSessionStatus(sessionId, "completed");
      
      // Rimuove lo stream dalla RAM liberandola istantaneamente
      activeStreams.delete(sessionId);
    });

  } catch (err) {
    console.error("❌ /p2p/session/download:", err.message);
    return res.status(500).send("Errore interno di download");
  }
});

// ============================================================
// 5) GET SESSIONE OPZIONALE
// ============================================================
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
