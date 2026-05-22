import admin from "firebase-admin";
import fs from "fs";

let serviceAccount = null;

/* -------------------------------------------------------
 * 1. Tenta di leggere FIREBASE_CONFIG (se esiste)
 * -----------------------------------------------------*/
if (process.env.FIREBASE_CONFIG) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
    console.log("✅ Firebase: letto testo da variabile FIREBASE_CONFIG");
  } catch (err) {
    console.error("❌ Firebase: Errore nel parsing di FIREBASE_CONFIG:", err.message);
  }
}

/* -------------------------------------------------------
 * 2. Se non esiste FIREBASE_CONFIG, usa il file locale
 * -----------------------------------------------------*/
if (!serviceAccount) {
  const localPath = "./winkwink-app-firebase-adminsdk-fbsvc-5001e4579b.json";

  if (fs.existsSync(localPath)) {
    try {
      serviceAccount = JSON.parse(fs.readFileSync(localPath, "utf8"));
      console.log("✅ Firebase: caricato file JSON locale");
    } catch (err) {
      console.error("❌ Firebase: Errore nel parsing del file locale:", err.message);
    }
  } else {
    console.error("❌ ERRORE: File JSON Firebase non trovato!");
  }
}

/* -------------------------------------------------------
 * 3. Patch crittografica: corregge i \n della private key
 * -----------------------------------------------------*/
if (serviceAccount && serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
}

/* -------------------------------------------------------
 * 4. Inizializzazione Firebase Admin
 * -----------------------------------------------------*/
if (serviceAccount && admin.apps.length === 0) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("🚀 Firebase Admin SDK inizializzato correttamente con patch crittografica attiva");
  } catch (err) {
    console.error("❌ Errore durante admin.initializeApp:", err.message);
  }
}

/* -------------------------------------------------------
 * 5. Funzione per inviare notifiche push (FCM)
 * -----------------------------------------------------*/
export async function sendFCM({ token, data }) {
  console.log("📡 [DEBUG FCM] Richiesta invio notifiche in corso...");

  if (!token) {
    console.log("⚠️ [DEBUG FCM] Abortito: Token destinatario mancante");
    return;
  }

  const message = {
    token: token,
    data: data,
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
