import express from "express";
import multer from "multer";
import cors from "cors";
import { exec } from "child_process";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// ------------------------------------------------------------
// ENCODE: riceve frame + audio e crea il video stego
// ------------------------------------------------------------
app.post("/encode", upload.array("files"), async (req, res) => {
  try {
    const audio = req.files.find(f => f.originalname.endsWith(".mp3"));
    const frames = req.files.filter(f => f !== audio);

    if (!audio || frames.length === 0) {
      return res.status(400).json({ error: "Missing frames or audio" });
    }

    const framesDir = `frames_${Date.now()}`;
    fs.mkdirSync(framesDir);

    frames.forEach((f, i) => {
      fs.renameSync(f.path, `${framesDir}/frame_${String(i).padStart(5, "0")}.png`);
    });

    const output = `output_${Date.now()}.mp4`;

    const cmd = `
      ffmpeg -y -framerate 30 -i ${framesDir}/frame_%05d.png \
      -i ${audio.path} -c:v libx264 -pix_fmt yuv420p -c:a aac ${output}
    `;

    exec(cmd, (err) => {
      if (err) return res.status(500).json({ error: err.message });

      res.download(output, () => {
        fs.rmSync(framesDir, { recursive: true, force: true });
        fs.unlinkSync(audio.path);
        fs.unlinkSync(output);
      });
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------
// EXTRACT: riceve un video e restituisce i frame
// ------------------------------------------------------------
app.post("/extract", upload.single("video"), async (req, res) => {
  try {
    const video = req.file.path;
    const framesDir = `extract_${Date.now()}`;
    fs.mkdirSync(framesDir);

    const cmd = `
      ffmpeg -y -i ${video} ${framesDir}/frame_%05d.png
    `;

    exec(cmd, (err) => {
      if (err) return res.status(500).json({ error: err.message });

      const files = fs.readdirSync(framesDir).map(f => `${framesDir}/${f}`);
      res.json({ frames: files });

      fs.unlinkSync(video);
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(10000, () => {
  console.log("WinkWink backend running on port 10000");
});
