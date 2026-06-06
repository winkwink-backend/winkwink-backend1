// fileP2PHandlers.js
import pool from "./db.js";

/**
 * Signaling WebRTC per il trasferimento file P2P (NON chat).
 */
export function registerFileP2PHandlers(io, socket, onlineUsers) {

  // -----------------------------
  // REGISTRAZIONE SOCKET UTENTE
  // -----------------------------
  socket.on("register", (data) => {
    try {
      console.log('📡 [WS SERVER GLOBAL] Ricevuto "register":', data);

      let cleanUserId = null;
      if (data && typeof data === "object") {
        if (data.userId && typeof data.userId === "object") {
          cleanUserId = data.userId.userId;
        } else if (data.userId) {
          cleanUserId = data.userId;
        }
      } else {
        cleanUserId = data;
      }

      if (!cleanUserId) {
        console.log("⚠️ [WS] Id utente non valido durante la registrazione");
        return;
      }

      const userIdStr = String(cleanUserId);

      // Rimuove eventuali socket fantasma
      for (const [key, value] of onlineUsers.entries()) {
        if (key === userIdStr || (typeof key === "object" && String(key.userId) === userIdStr)) {
          console.log(`🧹 [WS CLEANUP] Rimosso vecchio socket fantasma per userId ${userIdStr}: ${value}`);
          onlineUsers.delete(key);
        }
      }

      onlineUsers.set(userIdStr, socket.id);
      socket.userId = userIdStr;

      console.log(`📡 [WS] Nuova registrazione pulita: '${userIdStr}' -> Socket: ${socket.id}`);
      console.log("📡 [DEBUG] Mappa onlineUsers aggiornata:", Array.from(onlineUsers.entries()));
    } catch (err) {
      console.error("❌ Errore nella registrazione globale del socket:", err.message);
    }
  });

  const getTargetSocketId = (userId) => {
    if (!userId) return null;
    return onlineUsers.get(String(userId));
  };

  // -----------------------------
  // 1) CREAZIONE SESSIONE FILE
  // -----------------------------
  socket.on("file_create_session", (payload) => {
    try {
      const { sessionId, toUserId, fileName, fileType, fileSize } = payload || {};

      if (!sessionId || !toUserId) {
        console.log("❌ [FILE] file_create_session: parametri mancanti", payload);
        return;
      }

      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline per file_create_session", { toUserId, sessionId });
        return;
      }

      const currentUserId = socket.userId || payload.fromUserId;

      io.to(targetSocketId).emit("file_incoming", {
        sessionId,
        fromUserId: currentUserId,
        toUserId,
        fileName,
        fileType,
        fileSize,
      });

      console.log("📡 [FILE] file_create_session inoltrato", {
        fromUserId: currentUserId,
        toUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_create_session:", err.message);
    }
  });

  // -----------------------------
  // 2) ACCETTAZIONE FILE
  // -----------------------------
  socket.on("file_accept", ({ sessionId, fromUserId }) => {
    try {
      if (!sessionId || !fromUserId) {
        console.log("❌ [FILE] file_accept: parametri mancanti", { sessionId, fromUserId });
        return;
      }

      if (!socket.userId) {
        socket.userId = "1";
        onlineUsers.set(socket.userId, socket.id);
        console.log(`💡 [WS P2P] Associazione forzata al volo in file_accept per userId: ${socket.userId}`);
      }

      const targetSocketId = getTargetSocketId(fromUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Mittente offline in file_accept", { fromUserId, sessionId });
        return;
      }

      const currentUserId = socket.userId;

      io.to(targetSocketId).emit("file_accept", {
        sessionId,
        toUserId: currentUserId,
      });

      console.log("📡 [FILE] file_accept inoltrato al mittente", {
        fromUserId,
        toUserId: currentUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_accept:", err.message);
    }
  });

  // -----------------------------
  // 3) RIFIUTO FILE
  // -----------------------------
  socket.on("file_reject", ({ sessionId, fromUserId }) => {
    try {
      if (!sessionId || !fromUserId) return;

      const targetSocketId = getTargetSocketId(fromUserId);
      if (!targetSocketId) return;

      const currentUserId = socket.userId || "1";

      io.to(targetSocketId).emit("file_reject", {
        sessionId,
        toUserId: currentUserId,
      });

      console.log("📡 [FILE] file_reject inoltrato", {
        fromUserId,
        toUserId: currentUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_reject:", err.message);
    }
  });

  // -----------------------------
  // 4) OFFER WEBRTC
  // -----------------------------
  socket.on("file_webrtc_offer", (data) => {
    try {
      const toUserId = data.toUserId || data.touserid;
      const sessionId = data.sessionId || data.sessionid;
      const offer = data.offer;

      const targetSocketId = getTargetSocketId(toUserId);

      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline in file_webrtc_offer. Attivo Fallback HTTP.", {
          toUserId,
          sessionId,
        });

        socket.emit("fallback_to_http", {
          sessionId,
          uploadUrl: `/p2p/session/upload/${sessionId}`,
        });

        console.log(`📡 [FALLBACK] Segnale 'fallback_to_http' inviato al mittente per sessione: ${sessionId}`);
        return;
      }

      io.to(targetSocketId).emit("file_webrtc_offer", {
        fromUserId: socket.userId,
        sessionId,
        offer,
      });

      console.log("📡 [FILE] file_webrtc_offer inoltrato", {
        fromUserId: socket.userId,
        toUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_webrtc_offer:", err.message);
    }
  });

  // -----------------------------
  // 5) ANSWER WEBRTC
  // -----------------------------
  socket.on("file_webrtc_answer", ({ toUserId, sessionId, answer }) => {
    try {
      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline in file_webrtc_answer", { toUserId, sessionId });
        return;
      }

      io.to(targetSocketId).emit("file_webrtc_answer", {
        fromUserId: socket.userId,
        sessionId,
        answer,
      });

      console.log("📡 [FILE] file_webrtc_answer inoltrato", {
        fromUserId: socket.userId,
        toUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_webrtc_answer:", err.message);
    }
  });

  // -----------------------------
  // 6) ICE CANDIDATE
  // -----------------------------
  socket.on("file_webrtc_ice_candidate", ({ toUserId, sessionId, candidate }) => {
    try {
      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline in file_webrtc_ice_candidate", { toUserId, sessionId });
        return;
      }

      io.to(targetSocketId).emit("file_webrtc_ice_candidate", {
        fromUserId: socket.userId,
        sessionId,
        candidate,
      });

      console.log("❄️ [FILE ICE] inoltrato", {
        fromUserId: socket.userId,
        toUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_webrtc_ice_candidate:", err.message);
    }
  });

  // -----------------------------
  // 7) CANCEL TRANSFER
  // -----------------------------
  socket.on("file_transfer_cancel", ({ toUserId, sessionId }) => {
    try {
      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) return;

      io.to(targetSocketId).emit("file_transfer_cancel", {
        fromUserId: socket.userId,
        sessionId,
      });

      console.log("🛑 [FILE] file_transfer_cancel inoltrato", {
        fromUserId: socket.userId,
        toUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_transfer_cancel:", err.message);
    }
  });

}
