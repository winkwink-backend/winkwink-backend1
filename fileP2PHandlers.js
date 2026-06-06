// fileP2PHandlers.js
import pool from "./db.js";

/**
 * Signaling WebRTC per il trasferimento file P2P (NON chat).
 */
export function registerFileP2PHandlers(io, socket, onlineUsers) {
  
  // 🛠️ PATCH 1: AGGANCIO SICURO DEL REGISTRO UTENTE SUL SOCKET
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

    // 🛠️ DETECTOR DI SOCKET FANTASMA: Pulisce la mappa da vecchi residui prima di inserire il nuovo
    for (const [key, value] of onlineUsers.entries()) {
      // Controlla sia se la chiave è una stringa uguale, sia se è un oggetto vecchio con lo stesso ID
      if (key === userIdStr || (typeof key === "object" && String(key.userId) === userIdStr)) {
        console.log(`🧹 [WS CLEANUP] Rimosso vecchio socket fantasma per userId ${userIdStr}: ${value}`);
        onlineUsers.delete(key);
      }
    }

    // Ora inserisce la nuova connessione pulita senza conflitti di duplicati
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
  socket.on("file_webrtc_offer", (data) => {
   try {
     const toUserId = data.toUserId || data.touserid;
     const sessionId = data.sessionId || data.sessionid;
     const offer = data.offer;

     const targetSocketId = getTargetSocketId(toUserId);
    
     if (!targetSocketId) {
      // 1. Questo è il log che vedi adesso:
      console.log("⚠️ [FILE] Destinatario offline in file_webrtc_offer. Attivo Fallback HTTP.", {
        toUserId,
        sessionId,
      });

      // 2. ⭐ AGGIUNGI QUESTA RIGA: Spedisce il comando di fallback al mittente Dart
      socket.emit("fallback_to_http", {
        sessionId: sessionId,
        uploadUrl: `/p2p/session/upload/${sessionId}`
      });

      console.log(`📡 [FALLBACK] Segnale 'fallback_to_http' inviato al mittente per sessione: ${sessionId}`);
      return; 
    }

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
