// fileP2PHandlers.js
import pool from "./db.js";

/**
 * Gestione WebRTC P2P per trasferimento file diretto (app aperte).
 * Totalmente separato dal flusso HTTP.
 */

export function registerFileP2PHandlers(io, socket, onlineUsers) {
  /* ---------------------------------------------------------
     UTILS
  --------------------------------------------------------- */
  const getSocketId = (userId) => {
    if (!userId) return null;
    return onlineUsers.get(String(userId));
  };

  /* ---------------------------------------------------------
     0) REGISTRAZIONE SOCKET (solo per P2P)
  --------------------------------------------------------- */
  socket.on("register_p2p", (payload) => {
    try {
      const userId = String(payload?.userId ?? payload);
      if (!userId) return;

      // Rimuove eventuali socket fantasma
      for (const [key, value] of onlineUsers.entries()) {
        if (String(key) === userId) {
          onlineUsers.delete(key);
        }
      }

      onlineUsers.set(userId, socket.id);
      socket.userId = userId;

      console.log(`📡 [P2P] Registrato userId=${userId} socket=${socket.id}`);
    } catch (err) {
      console.error("❌ [P2P] Errore in register_p2p:", err.message);
    }
  });

  /* ---------------------------------------------------------
     1) CREAZIONE SESSIONE P2P (mittente → ricevente)
  --------------------------------------------------------- */
  socket.on("p2p_create_session", (data) => {
    try {
      const { sessionId, toUserId, fileName, fileType, fileSize } = data;
      const target = getSocketId(toUserId);

      if (!target) {
        console.log("⚠️ [P2P] Destinatario offline → fallback HTTP");
        socket.emit("p2p_fallback_http", { sessionId });
        return;
      }

      io.to(target).emit("p2p_incoming", {
        sessionId,
        fromUserId: socket.userId,
        toUserId,
        fileName,
        fileType,
        fileSize,
      });

      console.log("📡 [P2P] p2p_create_session inoltrato");
    } catch (err) {
      console.error("❌ [P2P] Errore in p2p_create_session:", err.message);
    }
  });

  /* ---------------------------------------------------------
     2) ACCETTAZIONE
  --------------------------------------------------------- */
  socket.on("p2p_accept", ({ sessionId, fromUserId }) => {
    try {
      const target = getSocketId(fromUserId);
      if (!target) {
        console.log("⚠️ [P2P] Mittente offline in p2p_accept");
        return;
      }

      io.to(target).emit("p2p_accept", {
        sessionId,
        toUserId: socket.userId,
      });

      console.log("📡 [P2P] p2p_accept inoltrato");
    } catch (err) {
      console.error("❌ [P2P] Errore in p2p_accept:", err.message);
    }
  });

  /* ---------------------------------------------------------
     3) RIFIUTO
  --------------------------------------------------------- */
  socket.on("p2p_reject", ({ sessionId, fromUserId }) => {
    try {
      const target = getSocketId(fromUserId);
      if (!target) return;

      io.to(target).emit("p2p_reject", {
        sessionId,
        toUserId: socket.userId,
      });

      console.log("📡 [P2P] p2p_reject inoltrato");
    } catch (err) {
      console.error("❌ [P2P] Errore in p2p_reject:", err.message);
    }
  });

  /* ---------------------------------------------------------
     4) OFFER WEBRTC
  --------------------------------------------------------- */
  socket.on("p2p_webrtc_offer", (data) => {
    try {
      const { toUserId, sessionId, offer } = data;
      const target = getSocketId(toUserId);

      if (!target) {
        console.log("⚠️ [P2P] Destinatario offline → fallback HTTP");
        socket.emit("p2p_fallback_http", { sessionId });
        return;
      }

      io.to(target).emit("p2p_webrtc_offer", {
        fromUserId: socket.userId,
        sessionId,
        offer,
      });

      console.log("📡 [P2P] p2p_webrtc_offer inoltrato");
    } catch (err) {
      console.error("❌ [P2P] Errore in p2p_webrtc_offer:", err.message);
    }
  });

  /* ---------------------------------------------------------
     5) ANSWER WEBRTC
  --------------------------------------------------------- */
  socket.on("p2p_webrtc_answer", (data) => {
    try {
      const { toUserId, sessionId, answer } = data;
      const target = getSocketId(toUserId);

      if (!target) {
        console.log("⚠️ [P2P] Destinatario offline in answer");
        return;
      }

      io.to(target).emit("p2p_webrtc_answer", {
        fromUserId: socket.userId,
        sessionId,
        answer,
      });

      console.log("📡 [P2P] p2p_webrtc_answer inoltrato");
    } catch (err) {
      console.error("❌ [P2P] Errore in p2p_webrtc_answer:", err.message);
    }
  });

  /* ---------------------------------------------------------
     6) ICE CANDIDATE
  --------------------------------------------------------- */
  socket.on("p2p_webrtc_ice", (data) => {
    try {
      const { toUserId, sessionId, candidate } = data;
      const target = getSocketId(toUserId);

      if (!target) return;

      io.to(target).emit("p2p_webrtc_ice", {
        fromUserId: socket.userId,
        sessionId,
        candidate,
      });
    } catch (err) {
      console.error("❌ [P2P] Errore in p2p_webrtc_ice:", err.message);
    }
  });
}
