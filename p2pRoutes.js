import { sendFCM } from "./firebase-config.js";

export const registerSocketHandlers = (io, socket, pool, onlineUsers, chatRooms) => {

  // ============================================================
  // LOG DIAGNOSTICO
  // ============================================================
  socket.onAny((eventName, ...args) => {
    console.log(`📡 [WS EVENT] Ricevuto: "${eventName}" con dati:`, JSON.stringify(args));
  });

  // ============================================================
  // PRESENZA (CHAT + P2P)
  // ============================================================
  socket.on("register", (userId) => {
    socket.userId = String(userId);
    onlineUsers.set(String(userId), socket.id);
    io.emit("user_online", { userId });
  });

  socket.on("disconnect", (reason) => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      io.emit("user_offline", { userId: socket.userId });
    }
  });

  // ============================================================
  // CHAT (stanze)
  // ============================================================
  socket.on("enter_chat", ({ chat_id, user_id }) => {
    if (!chatRooms.has(chat_id)) chatRooms.set(chat_id, new Set());
    chatRooms.get(chat_id).add(socket.id);

    socket.join(`chat_${chat_id}`);
    io.to(socket.id).emit("chat_joined", { chat_id });
    io.emit("user_in_chat", { chat_id, user_id });
  });

  socket.on("leave_chat", ({ chat_id, user_id }) => {
    if (chatRooms.has(chat_id)) {
      chatRooms.get(chat_id).delete(socket.id);
      if (chatRooms.get(chat_id).size === 0) chatRooms.delete(chat_id);
    }
    socket.leave(`chat_${chat_id}`);
  });

  socket.on("send_message", async (data) => {
    try {
      // DELETE
      if (data.type === "delete") {
        io.to(`chat_${data.chatId}`).emit("new_message", {
          chat_id: data.chatId,
          type: "delete",
          id: data.id,
        });
        return;
      }

      // NORMALE
      const { chatId, senderId, receiverId, content, type } = data;

      const result = await pool.query(
        `INSERT INTO chat_messages (chat_id, sender_id, receiver_id, content, type, status)
         VALUES ($1, $2, $3, $4, $5, 'sent')
         RETURNING *`,
        [chatId, senderId, receiverId, content, type ?? "text"]
      );

      const saved = result.rows[0];

      io.to(`chat_${chatId}`).emit("new_message", {
        id: saved.id,
        chat_id: chatId,
        sender_id: saved.sender_id,
        receiver_id: saved.receiver_id,
        content: saved.content,
        type: saved.type,
        status: saved.status,
        created_at: saved.created_at,
      });

    } catch (err) {
      console.error("❌ ERRORE SQL SOCKET:", err.message);
    }
  });

  // ============================================================
  // SIGNALING WEBRTC (solo chat/video)
  // ============================================================
  socket.on("offer", ({ toUserId, offer }) => {
    const target = onlineUsers.get(String(toUserId));
    if (target) io.to(target).emit("offer", { from: socket.userId, offer });
  });

  socket.on("answer", ({ toUserId, answer }) => {
    const target = onlineUsers.get(String(toUserId));
    if (target) io.to(target).emit("answer", { from: socket.userId, answer });
  });

  socket.on("ice_candidate", ({ toUserId, candidate }) => {
    const target = onlineUsers.get(String(toUserId));
    if (target) io.to(target).emit("ice_candidate", { from: socket.userId, candidate });
  });

  // ============================================================
  // ⭐ P2P WEBRTC (APP APERTA) — AGGIUNTO QUI
  // ============================================================

  // Alias compatibilità Flutter
  const alias = (from, to) => {
    socket.on(from, (data) => socket.emit(to, data));
  };

  alias("file_create_session", "p2p_create_session");
  alias("file_accept", "p2p_accept");
  alias("file_reject", "p2p_reject");
  alias("file_webrtc_offer", "p2p_webrtc_offer");
  alias("file_webrtc_answer", "p2p_webrtc_answer");
  alias("file_webrtc_ice_candidate", "p2p_webrtc_ice");

  // Registrazione P2P
  socket.on("register_p2p", ({ userId }) => {
    onlineUsers.set(String(userId), socket.id);
    socket.userId = String(userId);
  });

  // CREATE SESSION
  socket.on("p2p_create_session", (data) => {
    const { sessionId, toUserId, fileName, fileType, fileSize } = data;
    const target = onlineUsers.get(String(toUserId));

    if (!target) {
      socket.emit("p2p_fallback_http", { sessionId });
      return;
    }

    io.to(target).emit("p2p_incoming", {
      sessionId,
      fromUserId: socket.userId,
      fileName,
      fileType,
      fileSize
    });
  });

  // ACCEPT
  socket.on("p2p_accept", ({ sessionId, fromUserId }) => {
    const target = onlineUsers.get(String(fromUserId));
    if (target) {
      io.to(target).emit("p2p_accept", {
        sessionId,
        toUserId: socket.userId
      });
    }
  });

  // REJECT
  socket.on("p2p_reject", ({ sessionId, fromUserId }) => {
    const target = onlineUsers.get(String(fromUserId));
    if (target) {
      io.to(target).emit("p2p_reject", {
        sessionId,
        toUserId: socket.userId
      });
    }
  });

  // OFFER
  socket.on("p2p_webrtc_offer", (data) => {
    const { toUserId, sessionId, offer } = data;
    const target = onlineUsers.get(String(toUserId));

    if (!target) {
      socket.emit("p2p_fallback_http", { sessionId });
      return;
    }

    io.to(target).emit("p2p_webrtc_offer", {
      sessionId,
      fromUserId: socket.userId,
      offer
    });
  });

  // ANSWER
  socket.on("p2p_webrtc_answer", (data) => {
    const { toUserId, sessionId, answer } = data;
    const target = onlineUsers.get(String(toUserId));
    if (target) {
      io.to(target).emit("p2p_webrtc_answer", {
        sessionId,
        fromUserId: socket.userId,
        answer
      });
    }
  });

  // ICE
  socket.on("p2p_webrtc_ice", (data) => {
    const { toUserId, sessionId, candidate } = data;
    const target = onlineUsers.get(String(toUserId));
    if (target) {
      io.to(target).emit("p2p_webrtc_ice", {
        sessionId,
        fromUserId: socket.userId,
        candidate
      });
    }
  });
};
