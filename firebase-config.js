import admin from "firebase-admin";
import fs from "fs";

let serviceAccount = null;

// 1. Prova a caricare dalla variabile d'ambiente (Metodo consigliato per Railway)
if (process.env.FIREBASE_CONFIG) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    console.log("✅ Firebase: letto testo da variabile FIREBASE_CONFIG");
  } catch (err) {
    console.error("❌ Firebase: Errore nel parsing di FIREBASE_CONFIG:", err.message);
  }
}

// 2. Se la variabile non esiste, prova i percorsi dei file fisici (Locale o Render)
if (!serviceAccount) {
  const localPath = "./winkwink-app-firebase-adminsdk-fbsvc-db45b3d835.json";
  const renderSecretPath = "/etc/secrets/firebase-key.json";

  if (fs.existsSync(localPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(localPath, "utf8"));
    console.log("✅ Firebase: caricato file JSON locale");
  } else if (fs.existsSync(renderSecretPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(renderSecretPath, "utf8"));
    console.log("✅ Firebase: caricato da Secret File Render");
  } else {
    console.error("❌ ERRORE CRITICO: Configurazione Firebase non trovata!");
  }
}

// 3. 🔥 FIX ANTI-CRASH: Forza la formattazione crittografica corretta della Private Key
if (serviceAccount && serviceAccount.private_key) {
  // Sostituisce i backslash doppi errati con i reali a capo accettati da OAuth2
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

// 4. Inizializzazione di Firebase
if (serviceAccount && admin.apps.length === 0) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("🚀 Firebase Admin SDK inizializzato correttamente con patch crittografica attiva");
  } catch (err) {
    console.error("❌ Errore durante admin.initializeApp:", err.message);
  }
}

/**
 * Funzione per inviare notifiche push (FCM)
 */
export async function sendFCM({ token, data }) {
  console.log("📡 [DEBUG FCM] Richiesta invio notifiche in corso...");

  if (!token) {
    console.log("⚠️ [DEBUG FCM] Abortito: Token destinatario mancante");
    return;
  }

  const message = {
    token: token,
    data: data, // Invia solo dati (notifica silenziosa per gestione background)
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
    console.log("📨 [DEBUG FCM] Notifica inviata con successo! ID:", response);
  } catch (err) {
    console.error("❌ [DEBUG FCM] Errore critico invio Google API:", err.message);
  }
}

export default admin;
