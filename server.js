import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

<<<<<<< HEAD
// ⭐ IMPORTANTE: Firebase deve essere caricato PRIMA di tutto
import "./firebase-config.js";

=======
import "./firebase-config.js";
>>>>>>> 87e26a81e4f9cc1540fcc0641e5c2449085fc8df
import pool from "./db.js";

import authRoutes from "./authRoutes.js";
import chatRoutes from "./chatRoutes.js";
<<<<<<< HEAD
import uploadRoutes from "./uploadRoutes.js";
import { registerSocketHandlers } from "./socketHandlers.js";
=======
import filesRoutes from "./fileRoutes.js";
import userRoutes from "./userRoutes.js";
>>>>>>> 87e26a81e4f9cc1540fcc0641e5c2449085fc8df



import { registerSocketHandlers } from "./socketHandlers.js"; // ⭐ solo chat + presenza

// __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
<<<<<<< HEAD

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
=======
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));


app.use(userRoutes);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

>>>>>>> 87e26a81e4f9cc1540fcc0641e5c2449085fc8df
const onlineUsers = new Map();
const chatRooms = new Map();

// ⭐ Server HTTP + WebSocket
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ⭐ middleware
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  req.chatRooms = chatRooms;
  next();
});

// ⭐ rotte
app.use(authRoutes);
app.use(chatRoutes);
<<<<<<< HEAD
app.use("/chat", uploadRoutes);
=======
app.use("/files", filesRoutes);  // ⭐ nuovo upload HTTP
>>>>>>> 87e26a81e4f9cc1540fcc0641e5c2449085fc8df

// healthcheck
app.get("/", (req, res) => res.send("Backend WinkWink attivo"));

<<<<<<< HEAD
// ⭐ Socket (presenza + chat + WebRTC + file)
=======
// ⭐ socket (solo chat + presenza)
>>>>>>> 87e26a81e4f9cc1540fcc0641e5c2449085fc8df
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

<<<<<<< HEAD
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
=======
// ⭐ pulizia messaggi vecchi
setInterval(async () => {
  await pool.query(`
    DELETE FROM chat_messages
    WHERE created_at < NOW() - INTERVAL '72 hours'
  `);
}, 1000 * 60 * 60);

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server pronto sulla porta ${PORT}`);
>>>>>>> 87e26a81e4f9cc1540fcc0641e5c2449085fc8df
});
