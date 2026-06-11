import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

import "./firebase-config.js";
import pool from "./db.js";

import authRoutes from "./authRoutes.js";
import chatRoutes from "./chatRoutes.js";
import filesRoutes from "./fileRoutes.js";


import { registerSocketHandlers } from "./socketHandlers.js"; // ⭐ solo chat + presenza

// __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// ⭐ cartella uploads pubblica
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const onlineUsers = new Map();
const chatRooms = new Map();

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
app.use("/files", filesRoutes);  // ⭐ nuovo upload HTTP

// healthcheck
app.get("/", (req, res) => res.send("Backend WinkWink attivo"));

// ⭐ socket (solo chat + presenza)
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

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
});
