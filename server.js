console.log("📂 IL SERVER STA USANDO QUESTO FILE:", process.cwd());

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

import pool from "./db.js";
import authRoutes from "./authRoutes.js";
import p2pRoutes from "./p2pRoutes.js";   // ⬅️ NUOVO FILE RISCRITTO
import chatRoutes from "./chatRoutes.js";
import { registerSocketHandlers } from "./socketHandlers.js";

console.log("📂 IL FILE SOCKETHANDLERS È CARICATO DA QUI:", import.meta.url);

const app = express();
app.use(cors());
app.use(express.json());

const onlineUsers = new Map();
const chatRooms = new Map();

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// middleware per condividere io / onlineUsers / chatRooms
app.use((req, res, next) => {
  req.io = io;
  req.onlineUsers = onlineUsers;
  req.chatRooms = chatRooms;
  next();
});

// rotte HTTP
app.use(authRoutes);
app.use(p2pRoutes);   // ⬅️ nuovo flusso file
app.use(chatRoutes);

// healthcheck
app.get("/", (req, res) => res.send("Backend WinkWink attivo e modulare"));

// socket (PRESENZA + CHAT + WEBRTC CHAT) — FILE TRANSFER RIMOSSO
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`📂 Server + WebSocket pronti sulla porta ${PORT}`);
});
