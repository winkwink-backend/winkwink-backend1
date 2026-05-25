import { sendFCM } from "./firebase-config.js";

export const registerSocketHandlers = (io, socket, pool, onlineUsers, chatRooms) => {
  // log di tutti gli eventi
  socket.onAny((eventName, ...args) => {
    console.log(`📡 [WS EVENT] Ricevuto: "${eventName}" con dati:`, JSON.stringify(args));
  });

  // ------------------------------------------------------------
  // PRESENZA
  // ------------------------------------------------------------
  socket.on("register", (userId) => {
    console.log("📡 [DEBUG] REGISTER CHIAMATO", { userId, socketId: socket.id });
    socket.userId = userId;
    onlineUsers.set(userId, socket.id);
    console.log("📡 [WS] Utente registrato:", userId);
    console.log("📡 [DEBUG] onlineUsers:", Array.from(onlineUsers.entries()));
    io.emit("user_online", { userId });
  });

  socket.on("disconnect", (reason) => {
    console.log("📡 [WS] Disconnessione:", {
      socketId: socket.id,
      userId: socket.userId,
      reason,
    });

    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      console.log("📡 [DEBUG] DELETE ESEGUITO → onlineUsers:", Array.from(onlineUsers.entries()));
      io.emit("user_offline", { userId: socket.userId });
    } else {
      console.log("📡 [DEBUG] DISCONNECT SENZA USERID");
    }
  });

  // ------------------------------------------------------------
  // CHAT (stanze)
  // ------------------------------------------------------------
  socket.on("enter_chat", ({ chat_id, user_id }) => {
    if (!chatRooms.has(chat_id)) chatRooms.set(chat_id, new Set());
    chatRooms.get(chat_id).add(socket.id);

    socket.join(`chat_${chat_id}`);
    io.to(socket.id).emit("chat_joined", { chat_id });
    io.emit("user_in_chat", { chat_id, user_id });

    console.log(`📡 Utente ${user_id} entrato nella chat ${chat_id}`);
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
        `INSERT INTO chat_messages (chat_id, sender_id, receiver_id, content, type, status)
         VALUES ($1, $2, $3, $4, $5, 'sent')
         RETURNING *`,
       [
         chat_id,
         message.sender_id,
         message.receiver_id,
         message.content,
         message.type ?? "text"
       ]
     );


      const saved = result.rows[0];

      io.to(`chat_${chat_id}`).emit("new_message", {
        chat_id: parseInt(chat_id),
        sender_id: saved.sender_id,
        receiver_id: saved.receiver_id,
        content: saved.content,
        type: saved.type,
        status: saved.status,
        created_at: saved.created_at,
      });

      console.log(`✅ Messaggio Realtime: Chat ${chat_id}`);
    } catch (err) {
      console.error("❌ ERRORE SQL SOCKET:", err.message);
    }
  });

  // ------------------------------------------------------------
  // SIGNALING WEBRTC (solo chat/video, non file)
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
    console.log("❄️ [ICE] da", socket.userId, "→", toUserId, candidate?.candidate);
    const target = onlineUsers.get(toUserId);
    if (target) io.to(target).emit("ice_candidate", { from: socket.userId, candidate });
  });
};
