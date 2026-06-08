// p2p_webrtc_handlers.js
export function registerP2PWebRTCHandlers(io, socket, onlineUsers) {

    const getSocketId = (userId) => onlineUsers.get(String(userId));

    /* ---------------------------------------------------------
       REGISTRAZIONE P2P
    --------------------------------------------------------- */
    socket.on("register_p2p", ({ userId }) => {
        onlineUsers.set(String(userId), socket.id);
        socket.userId = String(userId);
    });

    /* ---------------------------------------------------------
       ALIAS COMPATIBILITÀ CON FLUTTER
    --------------------------------------------------------- */
    const alias = (from, to) => {
        socket.on(from, (data) => socket.emit(to, data));
    };

    alias("file_create_session", "p2p_create_session");
    alias("file_accept", "p2p_accept");
    alias("file_reject", "p2p_reject");
    alias("file_webrtc_offer", "p2p_webrtc_offer");
    alias("file_webrtc_answer", "p2p_webrtc_answer");
    alias("file_webrtc_ice_candidate", "p2p_webrtc_ice");

    /* ---------------------------------------------------------
       1) CREATE SESSION
    --------------------------------------------------------- */
    socket.on("p2p_create_session", (data) => {
        const { sessionId, toUserId, fileName, fileType, fileSize } = data;
        const target = getSocketId(toUserId);

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

    /* ---------------------------------------------------------
       2) ACCEPT
    --------------------------------------------------------- */
    socket.on("p2p_accept", ({ sessionId, fromUserId }) => {
        const target = getSocketId(fromUserId);
        if (!target) return;

        io.to(target).emit("p2p_accept", {
            sessionId,
            toUserId: socket.userId
        });
    });

    /* ---------------------------------------------------------
       3) REJECT
    --------------------------------------------------------- */
    socket.on("p2p_reject", ({ sessionId, fromUserId }) => {
        const target = getSocketId(fromUserId);
        if (!target) return;

        io.to(target).emit("p2p_reject", {
            sessionId,
            toUserId: socket.userId
        });
    });

    /* ---------------------------------------------------------
       4) OFFER
    --------------------------------------------------------- */
    socket.on("p2p_webrtc_offer", (data) => {
        const { toUserId, sessionId, offer } = data;
        const target = getSocketId(toUserId);

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

    /* ---------------------------------------------------------
       5) ANSWER
    --------------------------------------------------------- */
    socket.on("p2p_webrtc_answer", (data) => {
        const { toUserId, sessionId, answer } = data;
        const target = getSocketId(toUserId);
        if (!target) return;

        io.to(target).emit("p2p_webrtc_answer", {
            sessionId,
            fromUserId: socket.userId,
            answer
        });
    });

    /* ---------------------------------------------------------
       6) ICE
    --------------------------------------------------------- */
    socket.on("p2p_webrtc_ice", (data) => {
        const { toUserId, sessionId, candidate } = data;
        const target = getSocketId(toUserId);
        if (!target) return;

        io.to(target).emit("p2p_webrtc_ice", {
            sessionId,
            fromUserId: socket.userId,
            candidate
        });
    });
}
