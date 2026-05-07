console.log("📂 IL SERVER STA USANDO QUESTO FILE:", process.cwd());

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

// Import Moduli
import pool from "./db.js";
import authRoutes from "./authRoutes.js";
import p2pRoutes from "./p2pRoutes.js";
import chatRoutes from "./chatRoutes.js";
import { registerSocketHandlers } from "./socketHandlers.js";
console.log("📍 IL FILE SOCKETHANDLERS È CARICATO DA QUI:", import.meta.url);

const app = express();
app.use(cors());
app.use(express.json());

// Rotte HTTP normali
app.use(authRoutes);
app.use(p2pRoutes);
app.use(chatRoutes);

// Root
app.get("/", (req, res) => res.send("Backend WinkWink attivo e modulare"));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// ⭐ QUI CREI LE MAPPE (ora esistono)
const onlineUsers = new Map();
const chatRooms = new Map();

// ⭐ QUI REGISTRI I SOCKET
io.on("connection", (socket) => {
  registerSocketHandlers(io, socket, pool, onlineUsers, chatRooms);
});

// ------------------------------------------------------------
// ⭐ HTTP: FILE ACCEPT (quando l'app è chiusa)
// ------------------------------------------------------------
app.post("/file_accept_http", async (req, res) => {
    const { sessionId, userId } = req.body;

    console.log("🔥 [DEBUG] /file_accept_http ARRIVATO", { sessionId, userId });

    // 1️⃣ Verifica sessione
    const result = await pool.query(
        "SELECT from_user_id FROM p2p_sessions WHERE session_id = $1",
        [sessionId]
    );

    console.log("🔥 [DEBUG] RISULTATO QUERY SESSIONE:", result.rows);

    if (result.rows.length === 0) {
        console.log("❌ [DEBUG] NESSUNA SESSIONE TROVATA");
        return res.json({ ok: false });
    }

    const toUserId = result.rows[0].from_user_id;

    console.log("🔥 [DEBUG] MITTENTE (toUserId):", toUserId);

    // 2️⃣ Verifica se il mittente è online
    const target = onlineUsers.get(toUserId);

    console.log("🔥 [DEBUG] SOCKET MITTENTE TROVATO?", {
        toUserId,
        target,
        onlineUsers: Array.from(onlineUsers.entries())
    });

    if (target) {
        console.log("🔥 [DEBUG] INVIO file_accept → socket:", target);

        io.to(target).emit("file_accept", {
            sessionId,
            fromUserId: userId,
        });

        console.log("🔥 [DEBUG] INVIO open_download_page → socket:", target);

        io.to(target).emit("open_download_page", {
            sessionId,
            fromUserId: userId,
        });

        console.log("📤 [WS] open_download_page → mittente", toUserId);
    } else {
        console.log("❌ [DEBUG] MITTENTE OFFLINE → NESSUN WS INVIATO");
    }

    res.json({ ok: true });
});



const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server + WebSocket pronti sulla porta ${PORT}`);
});
