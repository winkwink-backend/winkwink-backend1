//per l'attach della chat
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// 📁 Cartella dove salvare i file
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");

// Se non esiste, la crea
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ⚙️ Configurazione Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, unique + ext);
  },
});

const upload = multer({ storage });

// 📤 ENDPOINT UPLOAD
router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nessun file ricevuto" });
  }

  // URL pubblico del file
  const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;

  console.log("📥 File ricevuto:", req.file.filename);
  console.log("📤 URL:", fileUrl);

  res.status(200).send(fileUrl);
});

module.exports = router;
