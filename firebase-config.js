import admin from "firebase-admin";
import fs from "fs";

let serviceAccount = null;
const localPath = "./winkwink-app-firebase-adminsdk-fbsvc-75fec530bf.json";
const renderSecretPath = "/etc/secrets/firebase-key.json"; 

if (fs.existsSync(localPath)) {
  serviceAccount = JSON.parse(fs.readFileSync(localPath, "utf8"));
  console.log("✅ Firebase: caricato file locale");
} else if (fs.existsSync(renderSecretPath)) {
  serviceAccount = JSON.parse(fs.readFileSync(renderSecretPath, "utf8"));
  console.log("✅ Firebase: caricato da Secret File Render");
} else {
  console.error("❌ ERRORE CRITICO: File JSON Firebase non trovato!");
}

if (serviceAccount && admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

export async function sendFCM({ token, data }) {
  console.log("📡 [DEBUG FCM] Inizio funzione sendFCM");
  console.log("- Token:", token ? token.substring(0, 15) : "MANCANTE");

  if (!token) {
    console.log("⚠️ [DEBUG FCM] Abortito: Token mancante");
    return;
  }

  const message = {
    token: token,
    data: data, // ⭐ SOLO DATA, NIENTE notification
    android: {
      priority: "high",
    },
    apns: {
      payload: {
        aps: {
          contentAvailable: true,
        },
      },
    },
  };

  try {
    console.log("- Destinatario:", token.substring(0, 15) + "...");
    const response = await admin.messaging().send(message);
    console.log("📨 [DEBUG FCM] Notifica inviata con successo! ID:", response);
  } catch (err) {
    console.error("❌ [DEBUG FCM] Errore durante l'invio:", err.message);
  }
}


export default admin;
