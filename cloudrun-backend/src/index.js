# index.js (Cloud Run backend)
import express from 'express';
import { VertexAI } from '@google-cloud/vertexai';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

const vertex = new VertexAI({
    project: process.env.GCP_PROJECT_ID,
    location: 'us-central1',
});

const model = vertex.getGenerativeModel({ model: 'gemini-1.5-pro' });

app.get('/health', (req, res) => res.json({ service: 'photomaton-api', status: 'healthy', version: '2.0.0' }));

app.post('/api/analyze', async (req, res) => {
    try {
        const { image_base64, mime_type = 'image/jpeg' } = req.body;
        if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });
        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime_type, data: image_base64 } }] }]
        });
        const text = result.response.candidates[0].content.parts.find(p => p.text)?.text;
        res.json({ status: 'success', analysis: text });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => console.log(Server listening on ));
