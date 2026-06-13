// socketHandlers.js (SOLO CHAT)

import { sendFCM } from "./firebase-config.js";

export const registerSocketHandlers = (io, socket, pool, onlineUsers, chatRooms) => {

  // ============================================================
  // LOG DIAGNOSTICO
  // ============================================================
  socket.onAny((eventName, ...args) => {
    console.log(`📡 [WS EVENT] Ricevuto: "${eventName}" con dati:`, JSON.stringify(args));
  });

  // ============================================================
  // PRESENZA (solo chat)
  // ============================================================
  socket.on("register", (userId) => {
    socket.userId = String(userId);
    onlineUsers.set(String(userId), socket.id);
    io.emit("user_online", { userId });
  });

  socket.on("disconnect", () => {
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

  // ============================================================
  // INVIO MESSAGGI CHAT
  // ============================================================
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
  // SIGNALING WEBRTC SOLO PER VIDEOCHAT (NON FILE)
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

};
