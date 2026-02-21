import { enhancePhoto } from './api.ts';

// --- State ---
interface CapturedFrame { data: string; mimeType: string; src: string; }

const state = {
    mediaType: 'none' as 'none' | 'image' | 'video',
    capturedFrames:  [] as CapturedFrame[],
    stylizedFrames:  [] as CapturedFrame[],
    previewInterval: null as number | null,
    isProcessing:    false,
    cameraStream:    null as MediaStream | null
};

function init() {
    attachListeners();
    document.getElementById('auth-overlay')?.classList.add('hidden');
}

function attachListeners() {
    document.getElementById('connect-cloud-btn')?.addEventListener('click', () => {
        document.getElementById('auth-overlay')?.classList.add('hidden');
    });
    document.getElementById('reconnect-btn')?.addEventListener('click', () => {
        document.getElementById('auth-overlay')?.classList.remove('hidden');
    });
    document.getElementById('media-upload')?.addEventListener('change', handleUpload);
    const cameraBtn = document.getElementById('camera-btn');
    if (cameraBtn) {
        cameraBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openCamera(); });
    }
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
    ['video-controls','result-wrapper','result-video','edit-section','download-btn','export-pdf-btn'].forEach(id =>
        document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('output-placeholder')?.classList.remove('hidden');
    const resultVideo  = document.getElementById('result-video')  as HTMLVideoElement;
    const videoPreview = document.getElementById('video-preview') as HTMLVideoElement;
    if (resultVideo?.src)  URL.revokeObjectURL(resultVideo.src);
    if (videoPreview?.src) URL.revokeObjectURL(videoPreview.src);
    document.getElementById('image-preview')?.classList.add('hidden');
    document.getElementById('video-preview')?.classList.add('hidden');
    document.getElementById('preview-placeholder')?.classList.remove('hidden');
}

async function openCamera() {
    try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        const feed = document.getElementById('camera-feed') as HTMLVideoElement;
        if (feed) feed.srcObject = state.cameraStream;
        document.getElementById('camera-overlay')?.classList.remove('hidden');
    } catch (err: any) {
        handleError(new Error('No se pudo acceder a la cámara: ' + err.message));
    }
}

function closeCamera() {
    state.cameraStream?.getTracks().forEach(t => t.stop());
    state.cameraStream = null;
    const feed = document.getElementById('camera-feed') as HTMLVideoElement;
    if (feed) feed.srcObject = null;
    document.getElementById('camera-overlay')?.classList.add('hidden');
}

function capturePhoto() {
    const feed   = document.getElementById('camera-feed') as HTMLVideoElement;
    const canvas = document.createElement('canvas');
    canvas.width  = feed.videoWidth;
    canvas.height = feed.videoHeight;
    canvas.getContext('2d')?.drawImage(feed, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    state.mediaType      = 'image';
    state.capturedFrames = [{ data: dataUrl.split(',')[1], mimeType: 'image/jpeg', src: dataUrl }];
    showImagePreview(dataUrl);
    enableGenerate(true);
    document.getElementById('edit-section')?.classList.remove('hidden');
    closeCamera();
}

async function extractVideoFrames() {
    const video  = document.getElementById('video-preview') as HTMLVideoElement;
    const slider = document.getElementById('frame-slider')  as HTMLInputElement;
    if (!video?.src) return;
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

async function generateStyle() {
    if (!state.capturedFrames.length) return;
    setLoading(true, "Transformando con IA...");
    state.stylizedFrames = [];
    const style = (document.getElementById('style-select') as HTMLSelectElement)?.value || 'Watercolor Painting';
    try {
        for (const frame of state.capturedFrames) {
            const res = await enhancePhoto(frame.data, frame.mimeType, style);
            if (res?.image_base64) {
                const mime = res.mime_type || 'image/jpeg';
                state.stylizedFrames.push({ data: res.image_base64, mimeType: mime, src: `data:${mime};base64,${res.image_base64}` });
            } else {
                state.stylizedFrames.push(frame);
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
    const promptText = (document.getElementById('edit-prompt') as HTMLInputElement)?.value.trim();
    if (!promptText) return;
    const sourceFrame = state.stylizedFrames.length > 0 ? state.stylizedFrames[0] : state.capturedFrames[0];
    if (!sourceFrame) return;
    setLoading(true, "Editando obra...");
    try {
        const res = await enhancePhoto(sourceFrame.data, sourceFrame.mimeType, promptText);
        if (res?.image_base64) {
            const mime = res.mime_type || 'image/jpeg';
            const editedFrame = { data: res.image_base64, mimeType: mime, src: `data:${mime};base64,${res.image_base64}` };
            state.stylizedFrames = [editedFrame];
            state.mediaType = 'image';
            presentResult();
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
    document.getElementById('download-btn')?.classList.remove('hidden');
    document.getElementById('export-pdf-btn')?.classList.remove('hidden');
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
        link.href = state.stylizedFrames[0].src; link.download = `art-${Date.now()}.jpg`;
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
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const availableWidth = pageWidth - (margin * 2);
    for (let i = 0; i < state.stylizedFrames.length; i++) {
        if (i > 0) doc.addPage();
        const frame = state.stylizedFrames[i];
        const img   = new Image();
        await new Promise(r => { img.onload = r; img.src = frame.src; });
        const drawHeight = availableWidth * (img.height / img.width);
        doc.addImage(frame.src, 'JPEG', margin, margin, availableWidth, drawHeight);
    }
    doc.save(`export-${Date.now()}.pdf`);
}

init();
