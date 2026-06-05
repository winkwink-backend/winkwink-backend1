import admin from "firebase-admin";
import fs from "fs";
import path from "path"; // ⭐ AGGIUNTO PER PERCORSI ASSOLUTI DI DIAGNOSTICA
import { fileURLToPath } from "url"; // ⭐ AGGIUNTO PER ES MODULES

// Gestione sicura dei percorsi assoluti per ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔍 STAMPE DI DIAGNOSTICA INIZIALE (Cosa legge davvero Railway?)
console.log("❓ [DIAGNOSTICA] La variabile FIREBASE_CONFIG esiste?", !!process.env.FIREBASE_CONFIG);
if (process.env.FIREBASE_CONFIG) {
  console.log("❓ [DIAGNOSTICA] Primi 20 caratteri della variabile:", process.env.FIREBASE_CONFIG.substring(0, 20));
}

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
  // ⭐ PATCH SICUREZZA: Garantisce il funzionamento sia locale che dentro il container Docker di Railway
  const localPath = path.resolve(__dirname, "./winkwink-app-firebase-adminsdk-fbsvc-e9ffa6b19c.json");

  if (fs.existsSync(localPath)) {
    try {
      serviceAccount = JSON.parse(fs.readFileSync(localPath, "utf8"));
      console.log("✅ Firebase: caricato file JSON locale");
    } catch (err) {
      console.error("❌ Firebase: Errore nel parsing del file locale:", err.message);
    }
  } else {
    console.error("❌ ERRORE CRITICO: File JSON Firebase non trovato né in locale né nelle var d'ambiente!");
  }
}

/* -------------------------------------------------------
 * 3. Patch crittografica: corregge i \n della private key
 * -----------------------------------------------------*/
if (serviceAccount && serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
}

/* -------------------------------------------------------
 * 4. Inizializzazione Firebase Admin (Migliorata)
 * -----------------------------------------------------*/
if (serviceAccount) {
  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log("🚀 Firebase Admin SDK inizializzato correttamente con patch crittografica attiva");
    } catch (err) {
      console.error("❌ Errore durante admin.initializeApp:", err.message);
    }
  }
} else {
  console.error("⚠️ ATTENZIONE: Impossibile inizializzare Firebase. serviceAccount è NULLO.");
}

/* -------------------------------------------------------
 * 5. Funzione per inviare notifiche push (FCM)
 * -----------------------------------------------------*/
export async function sendFCM({ token, data }) {
  console.log("📡 [DEBUG FCM] Richiesta invio notifiche in corso...");

  if (admin.apps.length === 0) {
    console.error("❌ [DEBUG FCM] Abortito: Firebase non è stato inizializzato all'avvio!");
    return;
  }

  if (!token) {
    console.log("⚠️ [DEBUG FCM] Abortito: Token destinatario mancante");
    return;
  }

  // 🛠️ PATCH BACKEND: Forziamo la conversione di ogni singola chiave in una stringa pulita
  const sanitizedData = {};
  for (const key in data) {
    if (data[key] !== undefined && data[key] !== null) {
      sanitizedData[key] = String(data[key]);
    }
  }

  const message = {
    token: token,
    data: sanitizedData, // Usa la mappa sanificata
    android: {
      priority: "high", // Garantisce la consegna immediata anche a schermo spento
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
