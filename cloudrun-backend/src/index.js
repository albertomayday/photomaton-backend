import express from "express";
import multer from "multer";
import { VertexAI } from "@google-cloud/vertexai";

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

const vertex = new VertexAI({
  project: process.env.GCP_PROJECT_ID || "gen-lang-client-0512040710",
  location: "us-central1",
});

const model = vertex.getGenerativeModel({ model: "gemini-1.5-pro-vision" });

app.get("/health", (req, res) => {
  res.json({ service: "photomaton-api", status: "healthy", version: "2.0.0" });
});

app.post("/api/v1/enhance-photo", async (req, res) => {
  try {
    const { image_base64, mime_type = "image/jpeg", style = "Watercolor Painting" } = req.body;
    if (!image_base64) return res.status(400).json({ error: "image_base64 required" });

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: mime_type, data: image_base64 } },
          { text: Transform this image into a high-quality  artwork. Preserve subjects. Professional finish. Return the image. }
        ]
      }]
    });

    const parts = result.response.candidates[0].content.parts;
    const imgPart = parts.find(p => p.inlineData);
    if (imgPart) {
      return res.json({ status: "success", image_base64: imgPart.inlineData.data, mime_type: imgPart.inlineData.mimeType });
    }
    res.json({ status: "success", text: parts.find(p => p.text)?.text });
  } catch (e) {
    console.error("enhance-photo error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/remove-background", async (req, res) => {
  try {
    const { image_base64, mime_type = "image/jpeg" } = req.body;
    if (!image_base64) return res.status(400).json({ error: "image_base64 required" });

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: mime_type, data: image_base64 } },
          { text: "Remove the background from this image. Keep only the main subject with a transparent background. Return the image." }
        ]
      }]
    });

    const parts = result.response.candidates[0].content.parts;
    const imgPart = parts.find(p => p.inlineData);
    if (imgPart) {
      return res.json({ status: "success", image_base64: imgPart.inlineData.data, mime_type: imgPart.inlineData.mimeType });
    }
    res.json({ status: "success", text: parts.find(p => p.text)?.text });
  } catch (e) {
    console.error("remove-background error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/v1/analyze-photo", async (req, res) => {
  try {
    const { image_base64, mime_type = "image/jpeg" } = req.body;
    if (!image_base64) return res.status(400).json({ error: "image_base64 required" });

    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType: mime_type, data: image_base64 } },
          { text: "Analyze this image in detail. Describe subjects, colors, composition, mood and style." }
        ]
      }]
    });

    const text = result.response.candidates[0].content.parts.find(p => p.text)?.text;
    res.json({ status: "success", analysis: text });
  } catch (e) {
    console.error("analyze-photo error:", e);
    res.status(500).json({ error: e.message });
  }
});

process.on("uncaughtException", e => console.error("UNCAUGHT:", e));
process.on("unhandledRejection", e => console.error("UNHANDLED:", e));

app.listen(PORT, "0.0.0.0", () => console.log("LISTENING ON", PORT));
