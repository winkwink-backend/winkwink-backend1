// fileP2PHandlers.js
import pool from "./db.js";

/**
 * Signaling WebRTC per il trasferimento file P2P (NON chat).
 *
 * Eventi:
 * - file_create_session
 * - file_accept
 * - file_reject
 * - file_webrtc_offer
 * - file_webrtc_answer
 * - file_webrtc_ice_candidate
 * - file_transfer_cancel
 */
export function registerFileP2PHandlers(io, socket, onlineUsers) {
  const getTargetSocketId = (userId) => {
    if (!userId) return null;
    return onlineUsers.get(String(userId));
  };

  // 1) Mittente crea sessione lato app (dopo eventuale /p2p/session/create HTTP o logica interna)
  socket.on("file_create_session", (payload) => {
    try {
      const {
        sessionId,
        toUserId,
        fileName,
        fileType,
        fileSize,
      } = payload || {};

      if (!sessionId || !toUserId) {
        console.log("❌ [FILE] file_create_session: parametri mancanti", payload);
        return;
      }

      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline per file_create_session", {
          toUserId,
          sessionId,
        });
        return;
      }

      io.to(targetSocketId).emit("file_incoming", {
        sessionId,
        fromUserId: socket.userId,
        toUserId,
        fileName,
        fileType,
        fileSize,
      });

      console.log("📡 [FILE] file_create_session inoltrato", {
        fromUserId: socket.userId,
        toUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_create_session:", err.message);
    }
  });

  // 2) Ricevente accetta (solo signaling P2P)
  socket.on("file_accept", ({ sessionId, fromUserId }) => {
    try {
      if (!sessionId || !fromUserId) {
        console.log("❌ [FILE] file_accept: parametri mancanti", {
          sessionId,
          fromUserId,
        });
        return;
      }

      const targetSocketId = getTargetSocketId(fromUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Mittente offline in file_accept", {
          fromUserId,
          sessionId,
        });
        return;
      }

      io.to(targetSocketId).emit("file_accept", {
        sessionId,
        toUserId: socket.userId,
      });

      console.log("📡 [FILE] file_accept inoltrato", {
        fromUserId,
        toUserId: socket.userId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_accept:", err.message);
    }
  });

  // 3) Ricevente rifiuta
  socket.on("file_reject", ({ sessionId, fromUserId }) => {
    try {
      if (!sessionId || !fromUserId) return;

      const targetSocketId = getTargetSocketId(fromUserId);
      if (!targetSocketId) return;

      io.to(targetSocketId).emit("file_reject", {
        sessionId,
        toUserId: socket.userId,
      });

      console.log("📡 [FILE] file_reject inoltrato", {
        fromUserId,
        toUserId: socket.userId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_reject:", err.message);
    }
  });

  // 4) WebRTC OFFER (DataChannel per file)
  socket.on("file_webrtc_offer", ({ toUserId, sessionId, offer }) => {
    try {
      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline in file_webrtc_offer", {
          toUserId,
          sessionId,
        });
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

  // 5) WebRTC ANSWER
  socket.on("file_webrtc_answer", ({ toUserId, sessionId, answer }) => {
    try {
      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline in file_webrtc_answer", {
          toUserId,
          sessionId,
        });
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

  // 6) ICE CANDIDATE
  socket.on("file_webrtc_ice_candidate", ({ toUserId, sessionId, candidate }) => {
    try {
      const targetSocketId = getTargetSocketId(toUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Destinatario offline in file_webrtc_ice_candidate", {
          toUserId,
          sessionId,
        });
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

  // 7) CANCEL TRANSFER
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
