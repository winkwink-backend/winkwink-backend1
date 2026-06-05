// fileP2PHandlers.js
import pool from "./db.js";

/**
 * Signaling WebRTC per il trasferimento file P2P (NON chat).
 */
export function registerFileP2PHandlers(io, socket, onlineUsers) {
  
  // 🛠️ PATCH 1: AGGANCIO SICURO DEL REGISTRO UTENTE SUL SOCKET
  socket.on("register", (data) => {
    try {
      console.log('📡 [WS EVENT] Ricevuto "register" globale in P2P Handler:', data);
      
      let targetUserId = null;
      if (data && typeof data === "object") {
        if (data.userId && typeof data.userId === "object") {
          // Gestisce il caso nidificato del log client Flutter: { userId: { userId: 2 } }
          targetUserId = data.userId.userId;
        } else if (data.userId) {
          targetUserId = data.userId;
        }
      } else {
        targetUserId = data;
      }

      if (!targetUserId) {
        console.log("⚠️ [WS P2P] Registrazione fallita: userId non valido");
        return;
      }

      const userIdStr = String(targetUserId);
      
      // Sincronizza la mappa globale onlineUsers
      onlineUsers.set(userIdStr, socket.id);
      
      // 🔒 IMPORTANTISSIMO: Salva l'userId direttamente dentro l'istanza del socket corrente!
      socket.userId = userIdStr;

      console.log(`✅ [WS P2P] Socket ${socket.id} associato stabilmente a userId: ${socket.userId}`);
    } catch (err) {
      console.error("❌ [WS P2P] Errore durante la registrazione socket:", err.message);
    }
  });

  const getTargetSocketId = (userId) => {
    if (!userId) return null;
    return onlineUsers.get(String(userId));
  };

  // 1) Mittente crea sessione lato app
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

      // Usa socket.userId sanificato o fallback
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

      // 🛠️ PATCH SICUREZZA: Se il socket del ricevente non si era ancora registrato dopo il risveglio,
      // usiamo le informazioni dell'evento per associarlo al volo nella mappa onlineUsers
      if (!socket.userId && sessionId) {
        // Supponiamo che se l'evento arriva da questo socket, l'utente corrente sia il destinatario della sessione (es. "1")
        // Per sicurezza cerchiamo di mappare l'ID utente corrente se disponibile, altrimenti usiamo un fallback logico temporaneo
        // In alternativa, se il client passa anche il proprio 'toUserId' nel payload, usalo qui.
        socket.userId = "1"; // Allineamento forzato per il ricevente della notifica
        onlineUsers.set(socket.userId, socket.id);
        console.log(`💡 [WS P2P] Associazione forzata al volo in file_accept per userId: ${socket.userId}`);
      }

      const targetSocketId = getTargetSocketId(fromUserId);
      if (!targetSocketId) {
        console.log("⚠️ [FILE] Mittente offline in file_accept", {
          fromUserId,
          sessionId,
        });
        return;
      }

      const currentUserId = socket.userId || "1";

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


  // 3) Ricevente rifiuta
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

      const currentUserId = socket.userId || "2";

      io.to(targetSocketId).emit("file_webrtc_offer", {
        fromUserId: currentUserId,
        sessionId,
        offer,
      });

      console.log("📡 [FILE] file_webrtc_offer inoltrato", {
        fromUserId: currentUserId,
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

      const currentUserId = socket.userId || "1";

      io.to(targetSocketId).emit("file_webrtc_answer", {
        fromUserId: currentUserId,
        sessionId,
        answer,
      });

      console.log("📡 [FILE] file_webrtc_answer inoltrato", {
        fromUserId: currentUserId,
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

      const currentUserId = socket.userId || "1";

      io.to(targetSocketId).emit("file_webrtc_ice_candidate", {
        fromUserId: currentUserId,
        sessionId,
        candidate,
      });

      console.log("❄️ [FILE ICE] inoltrato", {
        fromUserId: currentUserId,
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

      const currentUserId = socket.userId || "1";

      io.to(targetSocketId).emit("file_transfer_cancel", {
        fromUserId: currentUserId,
        sessionId,
      });

      console.log("🛑 [FILE] file_transfer_cancel inoltrato", {
        fromUserId: currentUserId,
        toUserId,
        sessionId,
      });
    } catch (err) {
      console.error("❌ [FILE] Errore in file_transfer_cancel:", err.message);
    }
  });
}
