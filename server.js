console.log("📂 IL SERVER STA USANDO QUESTO FILE:", process.cwd());

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import pool from "./db.js";
import authRoutes from "./authRoutes.js";
import p2pRoutes from "./p2pRoutes.js";
import chatRoutes from "./chatRoutes.js";
import uploadRoutes from "./uploadRoutes.js";   // ⭐ NUOVO
import { registerSocketHandlers } from "./socketHandlers.js";

console.log("📍 IL FILE SOCKETHANDLERS È CARICATO DA QUI:", import.meta.url);

// Necessario per __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
// 🔥 PATCH: aumenta limite per messaggi audio Base64
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


const onlineUsers = new Map();
const chatRooms = new Map();

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ⭐ Middleware per condividere io / onlineUsers / chatRooms
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  req.chatRooms = chatRooms;
  next();
});

// ⭐ Rotte HTTP
app.use(authRoutes);
app.use(p2pRoutes);
app.use(chatRoutes);
app.use("/chat", uploadRoutes);   // ⭐ NUOVO ENDPOINT UPLOAD

// Healthcheck
app.get("/", (req, res) => res.send("Backend WinkWink attivo e modulare"));

// ⭐ Socket (presenza + chat + WebRTC)
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server + WebSocket pronti sulla porta ${PORT}`);
});

// 🧹 Pulizia automatica messaggi scaduti (ogni ora)
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
}, 1000 * 60 * 60); // ogni ora

