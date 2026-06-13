import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

// ⭐ Firebase deve essere caricato PRIMA di tutto
import "./firebase-config.js";

import pool from "./db.js";

import authRoutes from "./authRoutes.js";
import chatRoutes from "./chatRoutes.js";
import uploadRoutes from "./uploadRoutes.js";   // upload HTTP
import filesRoutes from "./fileRoutes.js";      // se usi fileRoutes
import userRoutes from "./userRoutes.js";       // se usi userRoutes

import { registerSocketHandlers } from "./socketHandlers.js";

// __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// 🔥 PATCH: aumenta limite per messaggi audio/video Base64
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ⭐ Cartella uploads resa pubblica
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".mp4")) {
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Accept-Ranges", "bytes");
      }
      if (filePath.endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
      }
    }
  })
);

// ⭐ Mappe globali
const onlineUsers = new Map();
const chatRooms = new Map();

// ⭐ Server HTTP + WebSocket
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ⭐ middleware globale
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  req.chatRooms = chatRooms;
  next();
});

// ⭐ rotte HTTP
app.use(authRoutes);
app.use(chatRoutes);
app.use("/chat", uploadRoutes);   // upload chat
app.use("/files", filesRoutes);   // upload generici
app.use(userRoutes);              // utenti

// healthcheck
app.get("/", (req, res) => res.send("Backend WinkWink attivo"));

// ⭐ Socket (presenza + chat + WebRTC + file)
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

// ⭐ Pulizia automatica messaggi scaduti (ogni ora)
setInterval(async () => {
  try {
    await pool.query(`
      DELETE FROM chat_messages
      WHERE created_at < NOW() - INTERVAL '72 hours'
    `);
    console.log("🧹 Pulizia messaggi scaduti completata");
  } catch (err) {
    console.error("❌ Errore pulizia messaggi:", err.message);
  }
}, 1000 * 60 * 60);

// ⭐ Avvio server
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server + WebSocket pronti sulla porta ${PORT}`);
});
