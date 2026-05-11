import admin from "firebase-admin";
import fs from "fs";

let serviceAccount = null;

// 1. Prova a caricare dalla variabile d'ambiente (Metodo consigliato per Railway)
if (process.env.FIREBASE_CONFIG) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    console.log("✅ Firebase: caricato con successo dalla variabile FIREBASE_CONFIG");
  } catch (err) {
    console.error("❌ Firebase: Errore nel parsing di FIREBASE_CONFIG:", err.message);
  }
}

// 2. Se la variabile non esiste, prova i percorsi dei file fisici (Locale o Render)
if (!serviceAccount) {
  const localPath = "./winkwink-app-firebase-adminsdk-fbsvc-75fec530bf.json";
  const renderSecretPath = "/etc/secrets/firebase-key.json";

  if (fs.existsSync(localPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(localPath, "utf8"));
    console.log("✅ Firebase: caricato file JSON locale");
  } else if (fs.existsSync(renderSecretPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(renderSecretPath, "utf8"));
    console.log("✅ Firebase: caricato da Secret File Render");
  } else {
    console.error("❌ ERRORE CRITICO: Configurazione Firebase non trovata! Inserisci il JSON nella variabile FIREBASE_CONFIG su Railway.");
  }
}

// 3. Inizializzazione di Firebase
if (serviceAccount && admin.apps.length === 0) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("🚀 Firebase Admin SDK inizializzato correttamente");
  } catch (err) {
    console.error("❌ Errore durante admin.initializeApp:", err.message);
  }
}

/**
 * Funzione per inviare notifiche push (FCM)
 */
export async function sendFCM({ token, data }) {
  console.log("📡 [DEBUG FCM] Richiesta invio...");

  if (!token) {
    console.log("⚠️ [DEBUG FCM] Abortito: Token destinatario mancante");
    return;
  }

  const message = {
    token: token,
    data: data, // Invia solo dati (notifica silenziosa per gestione app)
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
    const response = await admin.messaging().send(message);
    console.log("📨 [DEBUG FCM] Notifica inviata! ID:", response);
  } catch (err) {
    console.error("❌ [DEBUG FCM] Errore invio:", err.message);
  }
}

export default admin;
