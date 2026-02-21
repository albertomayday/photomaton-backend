
import { GoogleGenAI } from "@google/genai";

// --- Configuration & Constants ---
// Upgrading to Pro as requested for Cloud Account integration and quality
const MODEL_STYLIZER = 'gemini-3-pro-image-preview';
const MODEL_EDITOR = 'gemini-3-pro-image-preview';

// --- State Management ---
const state = {
    mediaType: 'none',
    capturedFrames: [], 
    stylizedFrames: [], 
    previewInterval: null,
    isProcessing: false
};

// --- DOM Elements ---
const elements = {
    uploadInput: document.getElementById('media-upload'),
    cameraBtn: document.getElementById('camera-btn'),
    styleSelect: document.getElementById('style-select'),
    frameSlider: document.getElementById('frame-slider'),
    frameCountDisplay: document.getElementById('frame-count-display'),
    extractFramesBtn: document.getElementById('extract-frames-btn'),
    generateBtn: document.getElementById('generate-btn'),
    
    previewContainer: document.getElementById('media-preview-container'),
    imagePreview: document.getElementById('image-preview'),
    videoPreview: document.getElementById('video-preview'),
    previewPlaceholder: document.getElementById('preview-placeholder'),
    videoControls: document.getElementById('video-controls'),
    
    outputContainer: document.getElementById('output-container'),
    resultWrapper: document.getElementById('result-wrapper'),
    imgA: document.getElementById('result-img'), // Fixed ID: result-img instead of result-img-a
    resultVideo: document.getElementById('result-video'),
    outputPlaceholder: document.getElementById('output-placeholder'),
    loader: document.getElementById('loader'),
    loaderText: document.getElementById('loader-text'),
    downloadBtn: document.getElementById('download-btn'),
    exportPdfBtn: document.getElementById('export-pdf-btn'),
    
    editSection: document.getElementById('edit-section'),
    editPrompt: document.getElementById('edit-prompt'),
    applyEditBtn: document.getElementById('apply-edit-btn'),

    cameraOverlay: document.getElementById('camera-overlay'),
    cameraFeed: document.getElementById('camera-feed'),
    closeCameraBtn: document.getElementById('close-camera-btn'),
    takePhotoBtn: document.getElementById('take-photo-btn'),

    authOverlay: document.getElementById('auth-overlay'),
    connectBtn: document.getElementById('connect-cloud-btn'),
    reconnectBtn: document.getElementById('reconnect-btn'),
};

// --- Initialization ---

async function init() {
    await checkAuth();
    attachListeners();
}

async function checkAuth() {
    if (!window.aistudio) return;
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
        elements.authOverlay?.classList.remove('hidden');
    } else {
        elements.authOverlay?.classList.add('hidden');
    }
}

function attachListeners() {
    elements.connectBtn?.addEventListener('click', async () => {
        if (window.aistudio) {
            await window.aistudio.openSelectKey();
            elements.authOverlay?.classList.add('hidden');
        }
    });

    elements.reconnectBtn?.addEventListener('click', async () => {
        if (window.aistudio) await window.aistudio.openSelectKey();
    });

    elements.uploadInput?.addEventListener('change', handleUpload);
    elements.frameSlider?.addEventListener('input', (e) => {
        if (elements.frameCountDisplay) elements.frameCountDisplay.textContent = e.target.value;
    });
    elements.cameraBtn?.addEventListener('click', openCamera);
    elements.closeCameraBtn?.addEventListener('click', closeCamera);
    elements.takePhotoBtn?.addEventListener('click', capturePhoto);
    elements.extractFramesBtn?.addEventListener('click', extractVideoFrames);
    elements.generateBtn?.addEventListener('click', generateStyle);
    elements.applyEditBtn?.addEventListener('click', handleEditImage);
    elements.downloadBtn?.addEventListener('click', handleDownload);
    elements.exportPdfBtn?.addEventListener('click', handleExportPDF);
}

// --- Media Handling ---

async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    resetState();

    if (file.type.startsWith('image/')) {
        state.mediaType = 'image';
        const base64 = await fileToBase64(file);
        state.capturedFrames = [{
            data: base64,
            mimeType: file.type,
            src: `data:${file.type};base64,${base64}`
        }];
        showImagePreview(state.capturedFrames[0].src);
        if (elements.generateBtn) elements.generateBtn.disabled = false;
        
    } else if (file.type.startsWith('video/')) {
        state.mediaType = 'video';
        const url = URL.createObjectURL(file);
        if (elements.videoPreview) {
            elements.videoPreview.src = url;
            elements.videoPreview.classList.remove('hidden');
        }
        elements.previewPlaceholder?.classList.add('hidden');
        elements.videoControls?.classList.remove('hidden');
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showImagePreview(src) {
    if (elements.imagePreview) {
        elements.imagePreview.src = src;
        elements.imagePreview.classList.remove('hidden');
    }
    elements.previewPlaceholder?.classList.add('hidden');
    elements.videoPreview?.classList.add('hidden');
}

function resetState() {
    state.capturedFrames = [];
    state.stylizedFrames = [];
    state.isProcessing = false;
    clearInterval(state.previewInterval);
    
    if (elements.generateBtn) elements.generateBtn.disabled = true;
    elements.videoControls?.classList.add('hidden');
    elements.resultWrapper?.classList.add('hidden');
    elements.resultVideo?.classList.add('hidden');
    elements.outputPlaceholder?.classList.remove('hidden');
    elements.downloadBtn?.classList.add('hidden');
    elements.exportPdfBtn?.classList.add('hidden');
    elements.editSection?.classList.add('hidden');
    
    if (elements.resultVideo && elements.resultVideo.src) URL.revokeObjectURL(elements.resultVideo.src);
    if (elements.videoPreview && elements.videoPreview.src) URL.revokeObjectURL(elements.videoPreview.src);
    
    if (elements.imagePreview) {
        elements.imagePreview.src = '';
        elements.imagePreview.classList.add('hidden');
    }
    if (elements.videoPreview) {
        elements.videoPreview.src = '';
        elements.videoPreview.classList.add('hidden');
    }
    elements.previewPlaceholder?.classList.remove('hidden');
}

// --- Camera Logic ---

let cameraStream = null;

async function openCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' }, 
            audio: false 
        });
        if (elements.cameraFeed) elements.cameraFeed.srcObject = cameraStream;
        elements.cameraOverlay?.classList.remove('hidden');
    } catch (e) {
        alert('Could not access camera. Please check permissions.');
    }
}

function closeCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    elements.cameraOverlay?.classList.add('hidden');
}

function capturePhoto() {
    if (!elements.cameraFeed) return;
    const canvas = document.createElement('canvas');
    canvas.width = elements.cameraFeed.videoWidth;
    canvas.height = elements.cameraFeed.videoHeight;
    canvas.getContext('2d').drawImage(elements.cameraFeed, 0, 0);
    
    const dataUrl = canvas.toDataURL('image/jpeg');
    state.mediaType = 'image';
    resetState();
    
    state.capturedFrames = [{
        data: dataUrl.split(',')[1],
        mimeType: 'image/jpeg',
        src: dataUrl
    }];
    
    showImagePreview(dataUrl);
    if (elements.generateBtn) elements.generateBtn.disabled = false;
    closeCamera();
}

// --- Video Processing ---

async function extractVideoFrames() {
    const video = elements.videoPreview;
    if (!video || !video.duration) return;

    setLoading(true, "Extracting frames...");
    
    const count = parseInt(elements.frameSlider?.value || "10");
    const interval = video.duration / count;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    state.capturedFrames = [];
    
    for (let i = 0; i < count; i++) {
        video.currentTime = i * interval;
        await new Promise(r => video.addEventListener('seeked', r, { once: true }));
        ctx.drawImage(video, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        state.capturedFrames.push({
            data: dataUrl.split(',')[1],
            mimeType: 'image/jpeg',
            src: dataUrl
        });
    }

    setLoading(false);
    elements.videoPreview?.classList.add('hidden');
    elements.videoControls?.classList.add('hidden');
    elements.imagePreview?.classList.remove('hidden');
    if (elements.imagePreview) startAnimation(elements.imagePreview, state.capturedFrames);
    if (elements.generateBtn) elements.generateBtn.disabled = false;
}

function startAnimation(imgElement, frames, fps = 5) {
    clearInterval(state.previewInterval);
    let idx = 0;
    state.previewInterval = setInterval(() => {
        if (!frames[idx]) return;
        imgElement.src = frames[idx].src;
        idx = (idx + 1) % frames.length;
    }, 1000 / fps);
}

// --- Gemini Generation ---

async function generateStyle() {
    if (!process.env.API_KEY) return;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    if (!state.capturedFrames.length) return;

    setLoading(true, "Creating artwork with Gemini 3 Pro...");
    state.stylizedFrames = [];
    
    const style = elements.styleSelect?.value || 'Watercolor Painting';
    const prompt = `Transform this image into a ${style} style. Preserve the main subject with high detail and professional artistic quality.`;

    try {
        for (let i = 0; i < state.capturedFrames.length; i++) {
            if (state.capturedFrames.length > 1 && elements.loaderText) {
                elements.loaderText.textContent = `Styling frame ${i+1}/${state.capturedFrames.length}...`;
            }

            const frame = state.capturedFrames[i];
            const response = await ai.models.generateContent({
                model: MODEL_STYLIZER,
                contents: {
                    parts: [
                        { inlineData: { mimeType: frame.mimeType, data: frame.data } },
                        { text: prompt }
                    ]
                },
                config: {
                    imageConfig: {
                        aspectRatio: "16:9",
                        imageSize: "1K"
                    }
                }
            });

            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    state.stylizedFrames.push({
                        src: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                        data: part.inlineData.data,
                        mimeType: part.inlineData.mimeType
                    });
                }
            }
        }
        
        presentResult();
    } catch (err) {
        console.error(err);
        handleError(err);
    } finally {
        setLoading(false);
    }
}

async function handleEditImage() {
    if (!process.env.API_KEY) return;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const promptText = elements.editPrompt?.value.trim();
    if (!promptText || !state.stylizedFrames.length) return;

    setLoading(true, "Refining with Gemini 3 Pro...");
    
    try {
        const currentFrame = state.stylizedFrames[0];
        const response = await ai.models.generateContent({
            model: MODEL_EDITOR,
            contents: {
                parts: [
                    { inlineData: { mimeType: currentFrame.mimeType, data: currentFrame.data } },
                    { text: promptText }
                ]
            },
            config: {
                imageConfig: {
                    aspectRatio: "16:9",
                    imageSize: "1K"
                }
            }
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                state.stylizedFrames[0] = {
                    src: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType
                };
                state.mediaType = 'image'; 
                presentResult();
            }
        }
    } catch (err) {
        console.error("Edit failed:", err);
        if (err.message?.includes("entity was not found")) {
            if (window.aistudio) await window.aistudio.openSelectKey();
        } else {
            alert("Could not edit image. Check your Cloud project billing.");
        }
    } finally {
        setLoading(false);
    }
}

function handleError(err) {
    let msg = err.toString();
    if (msg.includes("entity was not found")) {
        msg = "Cloud project error. Re-selecting key...";
        if (window.aistudio) window.aistudio.openSelectKey();
    }
    if (elements.outputPlaceholder) {
        elements.outputPlaceholder.innerHTML = `<span style="color:#ff6b6b">${msg}</span>`;
        elements.outputPlaceholder.classList.remove('hidden');
    }
    elements.resultWrapper?.classList.add('hidden');
}

// --- Result Presentation ---

async function presentResult() {
    elements.outputPlaceholder?.classList.add('hidden');
    elements.resultWrapper?.classList.remove('hidden');
    elements.editSection?.classList.remove('hidden');
    
    if (state.stylizedFrames.length === 1) {
        if (elements.imgA) {
            elements.imgA.src = state.stylizedFrames[0].src;
            elements.imgA.classList.remove('hidden');
        }
        elements.resultVideo?.classList.add('hidden');
        elements.downloadBtn?.classList.remove('hidden');
        elements.exportPdfBtn?.classList.remove('hidden');
        return;
    }

    await createAndPlayVideo();
}

async function createAndPlayVideo() {
    if (elements.loaderText) elements.loaderText.textContent = "Encoding video sequence...";
    elements.loader?.classList.remove('hidden');

    try {
        const canvas = document.createElement('canvas');
        const img = new Image();
        
        await new Promise(r => { img.onload = r; img.src = state.stylizedFrames[0].src; });
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks = [];
        
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            if (elements.resultVideo) {
                elements.resultVideo.src = url;
                elements.resultVideo.classList.remove('hidden');
            }
            elements.imgA?.classList.add('hidden');
            elements.downloadBtn?.classList.remove('hidden');
            elements.exportPdfBtn?.classList.remove('hidden');
            elements.loader?.classList.add('hidden');
        };
        
        recorder.start();
        for (const frame of state.stylizedFrames) {
            await new Promise(r => {
                img.onload = () => {
                    ctx.drawImage(img, 0, 0);
                    r();
                };
                img.src = frame.src;
            });
            await new Promise(r => setTimeout(r, 100)); 
        }
        recorder.stop();
        
    } catch (e) {
        console.error("Encoding failed", e);
        elements.loader?.classList.add('hidden');
    }
}

// --- Utilities ---

function setLoading(active, text) {
    if (active) {
        elements.loader?.classList.remove('hidden');
        if (elements.loaderText) elements.loaderText.textContent = text;
        if (elements.generateBtn) elements.generateBtn.disabled = true;
        elements.outputPlaceholder?.classList.add('hidden');
    } else {
        elements.loader?.classList.add('hidden');
        if (elements.generateBtn) elements.generateBtn.disabled = false;
    }
}

function handleDownload() {
    const link = document.createElement('a');
    if (state.mediaType === 'image' || state.stylizedFrames.length === 1) {
        link.href = state.stylizedFrames[0].src;
        link.download = `art-${Date.now()}.png`;
    } else if (elements.resultVideo) {
        link.href = elements.resultVideo.src;
        link.download = `art-video-${Date.now()}.webm`;
    }
    link.click();
}

async function handleExportPDF() {
    if (!state.stylizedFrames.length) return;
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4"
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const availableWidth = pageWidth - (margin * 2);

    for (let i = 0; i < state.stylizedFrames.length; i++) {
        if (i > 0) doc.addPage();
        
        const frame = state.stylizedFrames[i];
        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = frame.src; });

        const imgRatio = img.height / img.width;
        const drawHeight = availableWidth * imgRatio;

        doc.addImage(frame.src, 'PNG', margin, margin, availableWidth, drawHeight);
        doc.setFontSize(10);
        doc.text(`Gemini 3 Pro Transfer - Page ${i + 1}`, margin, drawHeight + margin + 10);
    }

    doc.save(`gemini-cloud-export-${Date.now()}.pdf`);
}

// Start
init();
