//anche se ho nominato httproutes è p2p non http ad app chiusa

import express from "express";
import pool from "./db.js";
import { PassThrough } from "stream";

const router = express.Router();

// Mappa RAM per streaming concorrente
const activeStreams = new Map();

/* ---------------------------------------------------------
   UTILS
--------------------------------------------------------- */

async function getSession(sessionId) {
  const res = await pool.query(
    "SELECT * FROM p2p_sessions WHERE session_id = $1",
    [sessionId]
  );
  return res.rows[0] || null;
}

async function updateStatus(sessionId, status) {
  await pool.query(
    "UPDATE p2p_sessions SET status = $1, updated_at = NOW() WHERE session_id = $2",
    [status, sessionId]
  );
}

/* ---------------------------------------------------------
   1) CREAZIONE SESSIONE (solo metadati)
--------------------------------------------------------- */

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
       VALUES ($1,$2,$3,$4,$5,$6,'pending')
       RETURNING *`,
      [sessionId, from_user_id, to_user_id, fileSize, fileType, fileName ?? ""]
    );

    return res.json({
      session: result.rows[0],
      delivered: "ws",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
   2) ACCEPT (solo WebSocket)
--------------------------------------------------------- */

router.post("/p2p/session/accept", async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    const userId = req.body.userId;

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Sessione non trovata" });

    if (String(session.to_user_id) !== String(userId)) {
      return res.status(403).json({ error: "Non autorizzato" });
    }

    await updateStatus(sessionId, "accepted");

    const io = req.io;
    const onlineUsers = req.onlineUsers;

    const senderSocketId = onlineUsers.get(String(session.from_user_id));
    if (senderSocketId) {
      io.to(senderSocketId).emit("start_sending_file", {
        sessionId,
        fileName: session.file_name,
        fileType: session.file_type,
        fileSize: session.file_size,
        receiverId: session.to_user_id,
      });
    }

    return res.json({
      status: "ok",
      uploadUrl: `/p2p/session/upload/${sessionId}`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
   3) UPLOAD STREAMING (mittente → RAM)
--------------------------------------------------------- */

router.post("/p2p/session/upload/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: "Sessione non trovata" });

    if (session.status !== "accepted") {
      return res.status(400).json({ error: "Sessione non accettata" });
    }

    const tunnel = new PassThrough();
    activeStreams.set(sessionId, tunnel);

    req.pipe(tunnel);

    await updateStatus(sessionId, "uploaded");

    tunnel.on("end", () => {
      activeStreams.delete(sessionId);
    });

    return res.json({
      status: "ready_for_download",
      sessionId,
    });
  } catch (err) {
    activeStreams.delete(req.params.sessionId);
    return res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------
   4) DOWNLOAD STREAMING (RAM → ricevente)
--------------------------------------------------------- */

router.get("/p2p/session/download/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await getSession(sessionId);
    if (!session) return res.status(404).send("Sessione non trovata");

    const tunnel = activeStreams.get(sessionId);
    if (!tunnel) return res.status(404).send("File non disponibile");

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${session.file_name || "winkwink_file"}"`
    );
    res.setHeader("Content-Length", String(session.file_size));

    tunnel.pipe(res);

    res.on("finish", async () => {
      await updateStatus(sessionId, "completed");
      activeStreams.delete(sessionId);
    });
  } catch (err) {
    return res.status(500).send("Errore interno");
  }
});

/* ---------------------------------------------------------
   5) GET SESSION (debug)
--------------------------------------------------------- */

router.get("/p2p/session/:sessionId", async (req, res) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json({ session });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
