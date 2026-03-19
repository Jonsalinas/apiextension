require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const { Firestore } = require('@google-cloud/firestore');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 8080;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SPEECH_LANGUAGE = process.env.SPEECH_LANGUAGE || "es-ES";

// ─────────────────────────────────────────────
//  MIDDLEWARES
// ─────────────────────────────────────────────

// CORS: permite llamadas desde la extensión de Chrome
app.use(
  cors({
    origin: "*", // En producción puedes poner el ID de tu extensión
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
/*

para produccion especificar quienes
const allowedOrigins = [
  "https://tu-app.vercel.app",
  "chrome-extension://TU_EXTENSION_ID"
];



app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("No permitido por CORS"));
      }
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);
*/
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ─────────────────────────────────────────────
//  MULTER — manejo de archivos de audio
// ─────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `audio_${Date.now()}${path.extname(file.originalname) || ".ogg"}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB máximo
});

// ─────────────────────────────────────────────
//  FUNCIÓN: Convertir audio a FLAC (mono, 16kHz)
//  Google STT funciona mejor con este formato
// ─────────────────────────────────────────────
function convertToFlac(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace(/\.[^.]+$/, ".flac");

    ffmpeg(inputPath)
      .audioChannels(1)        // mono
      .audioFrequency(16000)   // 16kHz
      .toFormat("flac")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// ─────────────────────────────────────────────
//  FUNCIÓN: Llamar a Google Cloud Speech-to-Text
// ─────────────────────────────────────────────
async function transcribeWithGoogle(audioFilePath) {
  const audioBytes = fs.readFileSync(audioFilePath).toString("base64");

  const requestBody = {
    config: {
      encoding: "FLAC",
      sampleRateHertz: 16000,
      languageCode: SPEECH_LANGUAGE,
      enableAutomaticPunctuation: true,      // agrega puntuación automática
      model: "latest_long",                  // mejor modelo para audios largos
      useEnhanced: true,                     // modelo mejorado
    },
    audio: {
      content: audioBytes,
    },
  };

  const response = await axios.post(
    `https://speech.googleapis.com/v1/speech:recognize?key=${GOOGLE_API_KEY}`,
    requestBody,
    { headers: { "Content-Type": "application/json" } }
  );

  const results = response.data.results;

  if (!results || results.length === 0) {
    return { text: "", confidence: 0 };
  }

  // Une todos los fragmentos transcritos
  const fullText = results
    .map((r) => r.alternatives[0]?.transcript || "")
    .join(" ")
    .trim();

  const avgConfidence =
    results.reduce((acc, r) => acc + (r.alternatives[0]?.confidence || 0), 0) /
    results.length;

  return { text: fullText, confidence: avgConfidence };
}

// ─────────────────────────────────────────────
//  FUNCIÓN: Limpiar archivos temporales
// ─────────────────────────────────────────────
function cleanupFiles(...filePaths) {
  filePaths.forEach((filePath) => {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  });
}

// ─────────────────────────────────────────────
//  RUTA: GET /health — verificar que el server corre
// ─────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Backend de transcripción activo ✅",
    language: SPEECH_LANGUAGE,
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
//  RUTA: POST /transcribe — transcribir audio
//
//  La extensión envía el audio como multipart/form-data
//  Campo esperado: "audio" (archivo .ogg, .mp3, .wav, etc.)
// ─────────────────────────────────────────────
app.post("/transcribe", upload.single("audio"), async (req, res) => {
  let originalPath = null;
  let flacPath = null;

  try {
    // Validar que se envió un archivo
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No se recibió ningún archivo de audio. Campo esperado: 'audio'",
      });
    }

    console.log(`🎵 Audio recibido: ${req.file.filename} (${(req.file.size / 1024).toFixed(1)} KB)`);

    originalPath = req.file.path;

    // Convertir a FLAC para mejor compatibilidad con Google STT
    console.log("🔄 Convirtiendo audio a FLAC...");
    flacPath = await convertToFlac(originalPath);
    console.log("✅ Conversión completada");

    // Transcribir con Google Cloud Speech-to-Text
    console.log(`🔊 Enviando a Google Speech-to-Text (idioma: ${SPEECH_LANGUAGE})...`);
    const { text, confidence } = await transcribeWithGoogle(flacPath);
    
    await firestore.collection('usuarios').add({
      primer_nombre: "jon",
      segundo_nombre: "Ger",
      apellido: "Sal",
      correo: "micorreo@gmail.com",
      password:"123456789"
    });

    
    console.log(`✅ Transcripción: "${text}"`);

    // Limpiar archivos temporales
    cleanupFiles(originalPath, flacPath);

    // Responder a la extensión
    return res.json({
      success: true,
      text: text || "(Audio sin contenido reconocible)",
      confidence: parseFloat(confidence.toFixed(2)),
      language: SPEECH_LANGUAGE,
    });

  } catch (error) {
    // Limpiar en caso de error
    cleanupFiles(originalPath, flacPath);

    console.error("❌ Error en transcripción:", error.message);

    // Error específico de Google API
    if (error.response?.data) {
      console.error("Google API Error:", JSON.stringify(error.response.data, null, 2));
      return res.status(502).json({
        success: false,
        error: "Error en Google Speech-to-Text",
        details: error.response.data?.error?.message || "Error desconocido",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Error interno del servidor",
      details: error.message,
    });
  }
});

// ─────────────────────────────────────────────
//  RUTA: POST /save-message — guardar mensaje de texto
//  (Para los mensajes de texto del panel lateral)
// ─────────────────────────────────────────────
app.post("/save-message", (req, res) => {
  const { text, sender, timestamp, type } = req.body;

  if (!text) {
    return res.status(400).json({ success: false, error: "Campo 'text' requerido" });
  }

  // Aquí puedes guardar en base de datos si lo necesitas
  // Por ahora retorna confirmación
  console.log(`💬 Mensaje guardado: [${type || "text"}] ${sender}: "${text.substring(0, 50)}..."`);

  return res.json({
    success: true,
    message: "Mensaje recibido correctamente",
    data: { text, sender, timestamp, type },
  });
});



const db = new Firestore(); 

// Ejemplo para LEER un usuario de tu colección
async function obtenerUsuario(id) {
  const userRef = db.collection('usuarios').doc(id);
  const doc = await userRef.get();
  if (!doc.exists) {
    console.log('No existe el usuario');
  } else {
    console.log('Datos del usuario:', doc.data());
  }
}

// ─────────────────────────────────────────────
//  INICIAR SERVIDOR
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   🚀 Backend WhatsApp Transcriber        ║");
  console.log(`║   Puerto: http://localhost:${PORT}           ║`);
  console.log(`║   Idioma: ${SPEECH_LANGUAGE}                      ║`);
  console.log("╚══════════════════════════════════════════╝");
  console.log("");
  console.log("Endpoints disponibles:");
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  POST http://localhost:${PORT}/transcribe`);
  console.log(`  POST http://localhost:${PORT}/save-message`);
  console.log("");
});
