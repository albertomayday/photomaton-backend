import { GoogleGenAI } from "@google/genai";

// --- Configuration ---
// En Cloud Run: usa el proxy local /api-proxy (la key la inyecta server.js)
// En APK Android: usa la key de VITE directamente
const IS_NATIVE = !!(window as any).Capacitor?.isNativePlatform?.();
const API_KEY   = (import.meta as any).env?.VITE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const BASE_URL  = IS_NATIVE ? undefined : '/api-proxy';  // undefined = Gemini directo con key

const MODEL_STYLIZER = 'gemini-2.0-flash-exp-image-generation';
const MODEL_EDITOR   = 'gemini-2.0-flash-exp-image-generation';

function getAI(): GoogleGenAI {
    if (IS_NATIVE) {
        // APK: key inyectada por Vite en build time
        return new GoogleGenAI({ apiKey: API_KEY });
    } else {
        // Cloud Run: proxy local sin exponer key al cliente
        return new GoogleGenAI({ apiKey: 'proxy', httpOptions: { baseUrl: BASE_URL } });
    }
}

// --- State Management ---
interface CapturedFrame { data: string; mimeType: string; src: string; }

const state = {
    mediaType: 'none' as 'none' | 'image' | 'video',
    capturedFrames:  [] as CapturedFrame[],
    stylizedFrames:  [] as CapturedFrame[],
    previewInterval: null as number | null,
    isProcessing:    false,
    cameraStream:    null as MediaStream | null,
    github: {
        repo:  localStorage.getItem('gh_repo')  || '',
        token: localStorage.getItem('gh_token') || ''
    }
};

// --- Initialization ---
function init() {
    attachListeners();
    checkAuth();
    loadGitHubConfig();
}

async function checkAuth() {
    const authOverlay = document.getElementById('auth-overlay');
    if (!IS_NATIVE && !API_KEY) {
        // En web sin proxy activo
        authOverlay?.classList.remove('hidden');
    } else {
        authOverlay?.classList.add('hidden');
    }
}

function loadGitHubConfig() {
    const repoInput  = document.getElementById('gh-repo')  as HTMLInputElement;
    const tokenInput = document.getElementById('gh-token') as HTMLInputElement;
    if (repoInput)  repoInput.value  = state.github.repo;
    if (tokenInput) tokenInput.value = state.github.token;
}

function attachListeners() {
    document.getElementById('github-config-toggle')?.addEventListener('click', () => {
        document.getElementById('github-settings')?.classList.toggle('hidden');
    });
    document.getElementById('save-gh-config')?.addEventListener('click', () => {
        const repo  = (document.getElementById('gh-repo')  as HTMLInputElement).value.trim();
        const token = (document.getElementById('gh-token') as HTMLInputElement).value.trim();
        state.github.repo  = repo;
        state.github.token = token;
        localStorage.setItem('gh_repo',  repo);
        localStorage.setItem('gh_token', token);
        alert("Configuración de GitHub guardada.");
        document.getElementById('github-settings')?.classList.add('hidden');
        updateActionButtons();
    });
    document.getElementById('sync-github-btn')?.addEventListener('click', pushToGitHub);
    document.getElementById('connect-cloud-btn')?.addEventListener('click', () => {
        document.getElementById('auth-overlay')?.classList.add('hidden');
    });
    document.getElementById('reconnect-btn')?.addEventListener('click', () => {
        document.getElementById('auth-overlay')?.classList.remove('hidden');
    });
    document.getElementById('media-upload')?.addEventListener('change', handleUpload);
    const cameraBtn = document.getElementById('camera-btn');
    if (cameraBtn) cameraBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openCamera(); });
    document.getElementById('close-camera-btn')?.addEventListener('click', closeCamera);
    document.getElementById('take-photo-btn')?.addEventListener('click', capturePhoto);
    document.getElementById('frame-slider')?.addEventListener('input', (e) => {
        const val = (e.target as HTMLInputElement).value;
        const display = document.getElementById('frame-count-display');
        if (display) display.textContent = val;
    });
    document.getElementById('extract-frames-btn')?.addEventListener('click', extractVideoFrames);
    document.getElementById('generate-btn')?.addEventListener('click', generateStyle);
    document.getElementById('apply-edit-btn')?.addEventListener('click', handleEditImage);
    document.getElementById('download-btn')?.addEventListener('click', handleDownload);
    document.getElementById('export-pdf-btn')?.addEventListener('click', handleExportPDF);
}

// --- GitHub ---
async function pushToGitHub() {
    if (!state.github.repo || !state.github.token) {
        alert("Configura el repositorio y token de GitHub.");
        document.getElementById('github-settings')?.classList.remove('hidden');
        return;
    }
    if (!state.stylizedFrames.length) return;
    setLoading(true, "Sincronizando con GitHub...");
    const fileName = `art-${Date.now()}.png`;
    try {
        const response = await fetch(`https://api.github.com/repos/${state.github.repo}/contents/output/${fileName}`, {
            method: 'PUT',
            headers: { 'Authorization': `token ${state.github.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Add stylized artwork: ${fileName}`, content: state.stylizedFrames[0].data })
        });
        if (response.ok) { alert("Imagen subida con éxito."); }
        else { const err = await response.json(); throw new Error(err.message || "Error al subir a GitHub"); }
    } catch (e: any) {
        alert(`Fallo en la sincronización: ${e.message}`);
    } finally { setLoading(false); }
}

// --- Media ---
async function handleUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    resetState();
    if (file.type.startsWith('image/')) {
        state.mediaType = 'image';
        const base64 = await fileToBase64(file);
        state.capturedFrames = [{ data: base64, mimeType: file.type, src: `data:${file.type};base64,${base64}` }];
        showImagePreview(state.capturedFrames[0].src);
        enableGenerate(true);
        document.getElementById('edit-section')?.classList.remove('hidden');
    } else if (file.type.startsWith('video/')) {
        state.mediaType = 'video';
        const url = URL.createObjectURL(file);
        const videoPreview = document.getElementById('video-preview') as HTMLVideoElement;
        if (videoPreview) { videoPreview.src = url; videoPreview.classList.remove('hidden'); videoPreview.load(); }
        document.getElementById('preview-placeholder')?.classList.add('hidden');
        document.getElementById('video-controls')?.classList.remove('hidden');
    }
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showImagePreview(src: string) {
    const img = document.getElementById('image-preview') as HTMLImageElement;
    if (img) { img.src = src; img.classList.remove('hidden'); }
    document.getElementById('preview-placeholder')?.classList.add('hidden');
    document.getElementById('video-preview')?.classList.add('hidden');
}

function enableGenerate(enabled: boolean) {
    const btn = document.getElementById('generate-btn') as HTMLButtonElement;
    if (btn) btn.disabled = !enabled;
}

function resetState() {
    state.capturedFrames = [];
    state.stylizedFrames = [];
    state.isProcessing   = false;
    if (state.previewInterval) { clearInterval(state.previewInterval); state.previewInterval = null; }
    enableGenerate(false);
    ['video-controls','result-wrapper','result-video','download-btn','sync-github-btn','export-pdf-btn','edit-section']
        .forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('output-placeholder')?.classList.remove('hidden');
    const resultVideo  = document.getElementById('result-video')  as HTMLVideoElement;
    const videoPreview = document.getElementById('video-preview') as HTMLVideoElement;
    if (resultVideo?.src)  URL.revokeObjectURL(resultVideo.src);
    if (videoPreview?.src) URL.revokeObjectURL(videoPreview.src);
    document.getElementById('image-preview')?.classList.add('hidden');
    document.getElementById('video-preview')?.classList.add('hidden');
    document.getElementById('preview-placeholder')?.classList.remove('hidden');
}

// --- Camera ---
async function openCamera() {
    try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        const cameraFeed    = document.getElementById('camera-feed')    as HTMLVideoElement;
        const cameraOverlay = document.getElementById('camera-overlay');
        if (cameraFeed && state.cameraStream) {
            cameraFeed.srcObject = state.cameraStream;
            cameraFeed.setAttribute("playsinline", "true");
            cameraFeed.onloadedmetadata = () => cameraFeed.play().catch(console.error);
            cameraOverlay?.classList.remove('hidden');
        }
    } catch (e: any) {
        handleError(new Error('No se pudo acceder a la cámara: ' + e.message));
    }
}

function closeCamera() {
    state.cameraStream?.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
    const cameraFeed = document.getElementById('camera-feed') as HTMLVideoElement;
    if (cameraFeed) cameraFeed.srcObject = null;
    document.getElementById('camera-overlay')?.classList.add('hidden');
}

function capturePhoto() {
    const cameraFeed = document.getElementById('camera-feed') as HTMLVideoElement;
    if (!cameraFeed || !state.cameraStream) return;
    const canvas = document.createElement('canvas');
    canvas.width  = cameraFeed.videoWidth;
    canvas.height = cameraFeed.videoHeight;
    canvas.getContext('2d')?.drawImage(cameraFeed, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    state.mediaType      = 'image';
    state.capturedFrames = [{ data: dataUrl.split(',')[1], mimeType: 'image/jpeg', src: dataUrl }];
    showImagePreview(dataUrl);
    enableGenerate(true);
    document.getElementById('edit-section')?.classList.remove('hidden');
    closeCamera();
}

// --- Video ---
async function extractVideoFrames() {
    const video  = document.getElementById('video-preview') as HTMLVideoElement;
    const slider = document.getElementById('frame-slider')  as HTMLInputElement;
    if (!video?.duration) return;
    setLoading(true, "Extrayendo fotogramas...");
    const count    = parseInt(slider?.value || '10');
    const interval = video.duration / count;
    const canvas   = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    state.capturedFrames = [];
    for (let i = 0; i < count; i++) {
        video.currentTime = i * interval;
        await new Promise(r => video.addEventListener('seeked', r, { once: true }));
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        state.capturedFrames.push({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg', src: dataUrl });
    }
    setLoading(false);
    video.classList.add('hidden');
    document.getElementById('video-controls')?.classList.add('hidden');
    const imagePreview = document.getElementById('image-preview') as HTMLImageElement;
    imagePreview.classList.remove('hidden');
    startAnimation(imagePreview, state.capturedFrames);
    enableGenerate(true);
    document.getElementById('edit-section')?.classList.remove('hidden');
}

function startAnimation(imgElement: HTMLImageElement, frames: CapturedFrame[], fps = 5) {
    if (state.previewInterval) clearInterval(state.previewInterval);
    let idx = 0;
    state.previewInterval = window.setInterval(() => {
        if (!frames[idx]) return;
        imgElement.src = frames[idx].src;
        idx = (idx + 1) % frames.length;
    }, 1000 / fps);
}

// --- Gemini Generation ---
async function generateStyle() {
    if (IS_NATIVE && !API_KEY) { handleError(new Error('API Key no configurada.')); return; }
    if (!state.capturedFrames.length) return;
    const ai = getAI();
    setLoading(true, "Transformando con Gemini...");
    state.stylizedFrames = [];
    const style  = (document.getElementById('style-select') as HTMLSelectElement)?.value || 'Watercolor Painting';
    const prompt = `Transform this image into a ${style} style. Preserve the main subject with high detail.`;
    try {
        for (const frame of state.capturedFrames) {
            const response = await ai.models.generateContent({
                model:    MODEL_STYLIZER,
                contents: { parts: [{ inlineData: { mimeType: frame.mimeType, data: frame.data } }, { text: prompt }] },
                config:   { responseModalities: ['image', 'text'] }
            });
            const candidate = response.candidates?.[0];
            if (!candidate) throw new Error("Sin respuesta de la IA.");
            for (const part of candidate.content.parts) {
                if (part.inlineData) {
                    state.stylizedFrames.push({
                        src:      `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                        data:     part.inlineData.data,
                        mimeType: part.inlineData.mimeType
                    });
                }
            }
        }
        presentResult();
    } catch (err: any) {
        handleError(err);
    } finally {
        setLoading(false);
    }
}

async function handleEditImage() {
    if (IS_NATIVE && !API_KEY) { handleError(new Error('API Key no configurada.')); return; }
    const promptText = (document.getElementById('edit-prompt') as HTMLInputElement)?.value.trim();
    if (!promptText) return;
    const sourceFrame = state.stylizedFrames.length > 0 ? state.stylizedFrames[0] : state.capturedFrames[0];
    if (!sourceFrame) return;
    const ai = getAI();
    setLoading(true, "Editando obra...");
    try {
        const response = await ai.models.generateContent({
            model:    MODEL_EDITOR,
            contents: { parts: [{ inlineData: { mimeType: sourceFrame.mimeType, data: sourceFrame.data } }, { text: promptText }] },
            config:   { responseModalities: ['image', 'text'] }
        });
        const candidate = response.candidates?.[0];
        if (!candidate) throw new Error("Fallo en edición.");
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                state.stylizedFrames = [{
                    src:      `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                    data:     part.inlineData.data,
                    mimeType: part.inlineData.mimeType
                }];
                state.mediaType = 'image';
                presentResult();
            }
        }
    } catch (err: any) {
        handleError(err);
    } finally {
        setLoading(false);
    }
}

function handleError(err: any) {
    const msg = err?.message || err?.toString() || 'Error desconocido';
    console.error('[Photomaton]', msg);
    const placeholder = document.getElementById('output-placeholder');
    if (placeholder) { placeholder.innerHTML = `<span style="color:#ff6b6b">⚠️ ${msg}</span>`; placeholder.classList.remove('hidden'); }
}

function updateActionButtons() {
    if (state.stylizedFrames.length > 0) {
        document.getElementById('download-btn')?.classList.remove('hidden');
        document.getElementById('export-pdf-btn')?.classList.remove('hidden');
        if (state.github.repo && state.github.token)
            document.getElementById('sync-github-btn')?.classList.remove('hidden');
    }
}

async function presentResult() {
    document.getElementById('output-placeholder')?.classList.add('hidden');
    document.getElementById('result-wrapper')?.classList.remove('hidden');
    document.getElementById('edit-section')?.classList.remove('hidden');
    if (state.stylizedFrames.length === 1) {
        const resultImg = document.getElementById('result-img') as HTMLImageElement;
        if (resultImg) { resultImg.src = state.stylizedFrames[0].src; resultImg.classList.remove('hidden'); }
        document.getElementById('result-video')?.classList.add('hidden');
    } else {
        await createAndPlayVideo();
    }
    updateActionButtons();
}

async function createAndPlayVideo() {
    try {
        const canvas = document.createElement('canvas');
        const img    = new Image();
        await new Promise(r => { img.onload = r; img.src = state.stylizedFrames[0].src; });
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const stream   = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks: Blob[] = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url  = URL.createObjectURL(blob);
            const resultVideo = document.getElementById('result-video') as HTMLVideoElement;
            if (resultVideo) { resultVideo.src = url; resultVideo.classList.remove('hidden'); }
            document.getElementById('result-img')?.classList.add('hidden');
        };
        recorder.start();
        for (const frame of state.stylizedFrames) {
            await new Promise(r => { img.onload = () => { ctx.drawImage(img, 0, 0); r(null); }; img.src = frame.src; });
            await new Promise(r => setTimeout(r, 100));
        }
        recorder.stop();
    } catch (e) { console.error("Fallo de video", e); }
}

function setLoading(active: boolean, text?: string) {
    const loader     = document.getElementById('loader');
    const loaderText = document.getElementById('loader-text');
    if (active) {
        loader?.classList.remove('hidden');
        if (loaderText && text) loaderText.textContent = text;
        enableGenerate(false);
        document.getElementById('output-placeholder')?.classList.add('hidden');
    } else {
        loader?.classList.add('hidden');
        enableGenerate(true);
    }
}

function handleDownload() {
    const link = document.createElement('a');
    if (state.mediaType === 'image' || state.stylizedFrames.length === 1) {
        link.href = state.stylizedFrames[0].src; link.download = `art-${Date.now()}.png`;
    } else {
        const resultVideo = document.getElementById('result-video') as HTMLVideoElement;
        link.href = resultVideo.src; link.download = `art-vid-${Date.now()}.webm`;
    }
    link.click();
}

async function handleExportPDF() {
    if (!state.stylizedFrames.length) return;
    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth      = doc.internal.pageSize.getWidth();
    const margin         = 10;
    const availableWidth = pageWidth - (margin * 2);
    for (let i = 0; i < state.stylizedFrames.length; i++) {
        if (i > 0) doc.addPage();
        const frame = state.stylizedFrames[i];
        const img   = new Image();
        await new Promise(r => { img.onload = r; img.src = frame.src; });
        const drawHeight = availableWidth * (img.height / img.width);
        doc.addImage(frame.src, 'PNG', margin, margin, availableWidth, drawHeight);
    }
    doc.save(`export-${Date.now()}.pdf`);
}

init();
