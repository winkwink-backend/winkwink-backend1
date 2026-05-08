import { sendFCM } from "./firebase-config.js";

export const registerSocketHandlers = (io, socket, pool, onlineUsers, chatRooms) => {
  // LOG DI TUTTI GLI EVENTI IN ARRIVO
  socket.onAny((eventName, ...args) => {
    console.log(`📡 [DEBUG] Ricevuto evento: ${eventName}`, args);
  });

  // 🛰️ RADAR: Stampa TUTTI gli eventi che arrivano dai cellulari
  socket.onAny((eventName, ...args) => {
    console.log(`📡 [WS EVENT] Ricevuto: "${eventName}" con dati:`, JSON.stringify(args));
  });

  // ------------------------------------------------------------
  // PRESENZA E REGISTRAZIONE
  // ------------------------------------------------------------
  socket.on("register", (userId) => {
    console.log("🔥 [DEBUG] REGISTER CHIAMATO", { userId, socketId: socket.id });
    socket.userId = userId;
    onlineUsers.set(userId, socket.id);
    console.log("📨 [WS] Utente registrato:", userId);
    console.log("🔥 [DEBUG] onlineUsers:", Array.from(onlineUsers.entries()));
    io.emit("user_online", { userId });
  });

  socket.on("disconnect", (reason) => {
    console.log("📨 [WS] Disconnessione:", { socketId: socket.id, userId: socket.userId, reason });

    if (socket.userId) {
        onlineUsers.delete(socket.userId);
        console.log("🔥 [DEBUG] DELETE ESEGUITO → onlineUsers:", Array.from(onlineUsers.entries()));
        io.emit("user_offline", { userId: socket.userId });
    } else {
        console.log("🔥 [DEBUG] DISCONNECT SENZA USERID");
    }
  });


  // ------------------------------------------------------------
  // GESTIONE CHAT
  // ------------------------------------------------------------
  socket.on("enter_chat", ({ chat_id, user_id }) => {
    if (!chatRooms.has(chat_id)) chatRooms.set(chat_id, new Set());
    chatRooms.get(chat_id).add(socket.id);

    socket.join(`chat_${chat_id}`);
    io.to(socket.id).emit("chat_joined", { chat_id });
    io.emit("user_in_chat", { chat_id, user_id });

    console.log(`📨 Utente ${user_id} entrato nella chat ${chat_id}`);
  });

  socket.on("leave_chat", ({ chat_id, user_id }) => {
    if (chatRooms.has(chat_id)) {
      chatRooms.get(chat_id).delete(socket.id);
      if (chatRooms.get(chat_id).size === 0) chatRooms.delete(chat_id);
    }

    socket.leave(`chat_${chat_id}`);
    console.log(`↩️ Utente ${user_id} uscito dalla chat ${chat_id}`);
  });

  socket.on("send_message", async ({ chat_id, message }) => {
    try {
      const result = await pool.query(
        `INSERT INTO chat_messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *`,
        [chat_id, message.sender_id, message.content]
      );

      const saved = result.rows[0];

      io.to(`chat_${chat_id}`).emit("new_message", {
        chat_id: parseInt(chat_id),
        sender_id: saved.sender_id,
        content: saved.content,
        type: message.type ?? "text",
        created_at: saved.created_at,
      });

      console.log(`✅ Messaggio Realtime: Chat ${chat_id}`);
    } catch (err) {
      console.error("❌ ERRORE SQL SOCKET:", err.message);
    }
  });

  // ------------------------------------------------------------
  // SIGNALING WEBRTC
  // ------------------------------------------------------------
  socket.on("offer", ({ toUserId, offer }) => {
    const target = onlineUsers.get(toUserId);
    if (target) io.to(target).emit("offer", { from: socket.userId, offer });
  });

  socket.on("answer", ({ toUserId, answer }) => {
    const target = onlineUsers.get(toUserId);
    if (target) io.to(target).emit("answer", { from: socket.userId, answer });
  });

  socket.on("ice_candidate", ({ toUserId, candidate }) => {
    const target = onlineUsers.get(toUserId);
    if (target) io.to(target).emit("ice_candidate", { from: socket.userId, candidate });
  });



  // ------------------------------------------------------------
  // crea sessione
  // ------------------------------------------------------------

  socket.on("create_session", async (data) => {
  const {
    sessionId,
    fromUserId,
    toUserId,
    fileName,
    fileType,
    fileSize,
  } = data;

  try {
    console.log("📦 [WS] create_session ricevuto:", {
      sessionId,
      fromUserId,
      toUserId,
      fileName,
      fileType,
      fileSize,
    });

    // 1️⃣ SALVA SUBITO LA SESSIONE (operazione atomica)
    await pool.query(
      `INSERT INTO p2p_sessions
        (session_id, from_user_id, to_user_id, file_name, file_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id) DO NOTHING`,
      [sessionId, fromUserId, toUserId, fileName, fileType, fileSize]
    );

    console.log(`✅ [WS] Sessione salvata in p2p_sessions: ${sessionId}`);
  } catch (err) {
    console.error("❌ [WS] Errore in create_session:", err.message);
  }
});



  // ------------------------------------------------------------
  // FILE TRANSFER (REQUEST / ACCEPT / REJECT)
  // ------------------------------------------------------------

  socket.on("file_request", async ({ sessionId }) => {
  try {
    const result = await pool.query(
      "SELECT from_user_id, to_user_id FROM p2p_sessions WHERE session_id = $1",
      [sessionId]
    );

    if (result.rows.length === 0) {
      console.log("⚠️ [FILE_REQUEST] Nessuna sessione trovata per", sessionId);
      return;
    }

    const { from_user_id, to_user_id } = result.rows[0];

    // 🔥 Recupero nome/cognome del mittente
    const userRes = await pool.query(
      "SELECT name, surname FROM users WHERE id = $1",
      [from_user_id]
    );

    const senderName = userRes.rows[0]?.name || "";
    const senderSurname = userRes.rows[0]?.surname || "";

    const target = onlineUsers.get(to_user_id);

    //
    // ⭐ 1. UTENTE ONLINE → WebSocket
    //
    if (target) {
      io.to(target).emit("incoming_file", {
        sessionId,
        fromUserId: from_user_id,
        senderName,
        senderSurname,
      });
      console.log("📨 [WS] incoming_file → utente online", to_user_id);
      return;
    }

    //
    // ⭐ 2. UTENTE OFFLINE → FCM (incoming_file)
    //
    console.log("📵 [FILE_REQUEST] Utente offline, uso FCM per", to_user_id);

    const tokenRes = await pool.query(
      "SELECT fcm_token FROM users WHERE id = $1",
      [to_user_id]
    );

    const token = tokenRes.rows[0]?.fcm_token;

    if (!token) {
      console.log("⚠️ [FILE_REQUEST] Nessun token FCM per", to_user_id);
      return;
    }

    await sendFCM({
      token,
      data: {
        type: "incoming_file",
        sessionId: String(sessionId),
        fromUserId: String(from_user_id),
        senderName,
        senderSurname,
      },
    });

    console.log("📨 [FCM] incoming_file →", to_user_id);
  } catch (err) {
    console.error("❌ [FILE_REQUEST] Errore:", err.message);
  }
});


  socket.on("file_reject", async ({ sessionId }) => {
    const result = await pool.query(
      "SELECT from_user_id FROM p2p_sessions WHERE session_id = $1",
      [sessionId]
    );

    if (result.rows.length === 0) return;

    const toUserId = result.rows[0].from_user_id;
    const target = onlineUsers.get(toUserId);

    if (target) {
      io.to(target).emit("file_reject", {
        sessionId,
        fromUserId: socket.userId,
      });
    } else {
      const userRes = await pool.query(
        "SELECT fcm_token FROM users WHERE id = $1",
        [toUserId]
      );

      const token = userRes.rows[0]?.fcm_token;

      if (token) {
        await sendFCM({
          token,
          data: {
            type: "file_reject",
            sessionId,
            senderId: String(socket.userId),
          },
        });
      }
    }
  });

  // ------------------------------------------------------------
  // NOTIFICA APERTURA PAGINA DOWNLOAD (WAKE UP)
  // ------------------------------------------------------------
  socket.on("open_download_page", async ({ toUserId, payload }) => {
    console.log("📨 [WS] open_download_page ricevuto:", { toUserId, payload });

    const target = onlineUsers.get(toUserId);

    //
    // ⭐ 1. UTENTE ONLINE → WebSocket
    //
    if (target) {
      io.to(target).emit("open_download_page", {
        type: "open_download_page",
        ...payload,
      });
      console.log("📨 [WS] open_download_page →", toUserId);
      return;
    }

    //
    // ⭐ 2. UTENTE OFFLINE → FCM (incoming_file, NON open_download_page)
    //
    console.log("📵 Utente offline → invio FCM incoming_file");

    const userRes = await pool.query(
      "SELECT fcm_token FROM users WHERE id = $1",
      [toUserId]
    );

    const token = userRes.rows[0]?.fcm_token;

    if (token) {
      await sendFCM({
        token,
        data: {
          type: "incoming_file",
          sessionId: String(payload.sessionId),
          fileName: payload.fileName,
          fileType: payload.fileType,
          fileSize: String(payload.fileSize),
          fromUserId: String(payload.fromUserId),
        },
      });

      console.log("📨 [FCM] incoming_file →", toUserId);
    } else {
      console.log("⚠️ Nessun token FCM per", toUserId);
    }
  });
};
