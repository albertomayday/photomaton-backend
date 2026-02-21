import { GoogleGenAI } from "@google/genai";
const IS_NATIVE = !!(window as any).Capacitor?.isNativePlatform?.();
const API_KEY = (import.meta as any).env?.VITE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY || '';
const BASE_URL = IS_NATIVE ? undefined : '/api-proxy';
const MODEL_STYLIZER = 'gemini-2.0-flash-exp-image-generation';
const MODEL_EDITOR = 'gemini-2.0-flash-exp-image-generation';
function getAI() {
    if (IS_NATIVE) return new GoogleGenAI({ apiKey: API_KEY });
    return new GoogleGenAI({ apiKey: 'proxy', httpOptions: { baseUrl: BASE_URL } });
}
interface CapturedFrame { data: string; mimeType: string; src: string; }
const state = {
    mediaType: 'none' as 'none' | 'image' | 'video',
    capturedFrames: [] as CapturedFrame[], stylizedFrames: [] as CapturedFrame[],
    previewInterval: null as number | null, isProcessing: false,
    cameraStream: null as MediaStream | null,
    github: { repo: localStorage.getItem('gh_repo') || '', token: localStorage.getItem('gh_token') || '' }
};
function init() { attachListeners(); checkAuth(); loadGitHubConfig(); }
function checkAuth() {
    const a = document.getElementById('auth-overlay');
    if (IS_NATIVE && !API_KEY) a?.classList.remove('hidden');
    else a?.classList.add('hidden');
}
function loadGitHubConfig() {
    const r = document.getElementById('gh-repo') as HTMLInputElement;
    const t = document.getElementById('gh-token') as HTMLInputElement;
    if (r) r.value = state.github.repo;
    if (t) t.value = state.github.token;
}
function attachListeners() {
    document.getElementById('github-config-toggle')?.addEventListener('click', () => document.getElementById('github-settings')?.classList.toggle('hidden'));
    document.getElementById('save-gh-config')?.addEventListener('click', () => {
        state.github.repo = (document.getElementById('gh-repo') as HTMLInputElement).value.trim();
        state.github.token = (document.getElementById('gh-token') as HTMLInputElement).value.trim();
        localStorage.setItem('gh_repo', state.github.repo);
        localStorage.setItem('gh_token', state.github.token);
        alert("GitHub guardado.");
        document.getElementById('github-settings')?.classList.add('hidden');
        updateActionButtons();
    });
    document.getElementById('sync-github-btn')?.addEventListener('click', pushToGitHub);
    document.getElementById('connect-cloud-btn')?.addEventListener('click', () => document.getElementById('auth-overlay')?.classList.add('hidden'));
    document.getElementById('reconnect-btn')?.addEventListener('click', () => document.getElementById('auth-overlay')?.classList.remove('hidden'));
    document.getElementById('media-upload')?.addEventListener('change', handleUpload);
    document.getElementById('camera-btn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openCamera(); });
    document.getElementById('close-camera-btn')?.addEventListener('click', closeCamera);
    document.getElementById('take-photo-btn')?.addEventListener('click', capturePhoto);
    document.getElementById('frame-slider')?.addEventListener('input', (e) => {
        const v = (e.target as HTMLInputElement).value;
        const d = document.getElementById('frame-count-display'); if (d) d.textContent = v;
    });
    document.getElementById('extract-frames-btn')?.addEventListener('click', extractVideoFrames);
    document.getElementById('generate-btn')?.addEventListener('click', generateStyle);
    document.getElementById('apply-edit-btn')?.addEventListener('click', handleEditImage);
    document.getElementById('download-btn')?.addEventListener('click', handleDownload);
    document.getElementById('export-pdf-btn')?.addEventListener('click', handleExportPDF);
}
async function pushToGitHub() {
    if (!state.github.repo || !state.github.token) { alert("Configura GitHub primero."); document.getElementById('github-settings')?.classList.remove('hidden'); return; }
    if (!state.stylizedFrames.length) return;
    setLoading(true, "Sincronizando con GitHub...");
    try {
        const fileName = `art-${Date.now()}.png`;
        const res = await fetch(`https://api.github.com/repos/${state.github.repo}/contents/output/${fileName}`, {
            method: 'PUT', headers: { 'Authorization': `token ${state.github.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Add artwork: ${fileName}`, content: state.stylizedFrames[0].data })
        });
        if (res.ok) alert("Subido a GitHub.");
        else { const e = await res.json(); throw new Error(e.message); }
    } catch (e: any) { alert(`Error GitHub: ${e.message}`); } finally { setLoading(false); }
}
async function handleUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; resetState();
    if (file.type.startsWith('image/')) {
        state.mediaType = 'image'; const b = await fileToBase64(file);
        state.capturedFrames = [{ data: b, mimeType: file.type, src: `data:${file.type};base64,${b}` }];
        showImagePreview(state.capturedFrames[0].src); enableGenerate(true); document.getElementById('edit-section')?.classList.remove('hidden');
    } else if (file.type.startsWith('video/')) {
        state.mediaType = 'video'; const url = URL.createObjectURL(file);
        const vp = document.getElementById('video-preview') as HTMLVideoElement;
        if (vp) { vp.src = url; vp.classList.remove('hidden'); vp.load(); }
        document.getElementById('preview-placeholder')?.classList.add('hidden');
        document.getElementById('video-controls')?.classList.remove('hidden');
    }
}
function fileToBase64(file: File): Promise<string> {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
}
function showImagePreview(src: string) {
    const img = document.getElementById('image-preview') as HTMLImageElement;
    if (img) { img.src = src; img.classList.remove('hidden'); }
    document.getElementById('preview-placeholder')?.classList.add('hidden');
    document.getElementById('video-preview')?.classList.add('hidden');
}
function enableGenerate(e: boolean) { const b = document.getElementById('generate-btn') as HTMLButtonElement; if (b) b.disabled = !e; }
function resetState() {
    state.capturedFrames = []; state.stylizedFrames = []; state.isProcessing = false;
    if (state.previewInterval) { clearInterval(state.previewInterval); state.previewInterval = null; }
    enableGenerate(false);
    ['video-controls','result-wrapper','result-video','download-btn','sync-github-btn','export-pdf-btn','edit-section'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    document.getElementById('output-placeholder')?.classList.remove('hidden');
    const rv = document.getElementById('result-video') as HTMLVideoElement;
    const vp = document.getElementById('video-preview') as HTMLVideoElement;
    if (rv?.src) URL.revokeObjectURL(rv.src); if (vp?.src) URL.revokeObjectURL(vp.src);
    document.getElementById('image-preview')?.classList.add('hidden');
    document.getElementById('video-preview')?.classList.add('hidden');
    document.getElementById('preview-placeholder')?.classList.remove('hidden');
}
async function openCamera() {
    try {
        state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        const cf = document.getElementById('camera-feed') as HTMLVideoElement;
        if (cf && state.cameraStream) { cf.srcObject = state.cameraStream; cf.setAttribute("playsinline","true"); cf.onloadedmetadata = () => cf.play().catch(console.error); document.getElementById('camera-overlay')?.classList.remove('hidden'); }
    } catch (e: any) { handleError(new Error('Camara: ' + e.message)); }
}
function closeCamera() {
    state.cameraStream?.getTracks().forEach(t => t.stop()); state.cameraStream = null;
    const cf = document.getElementById('camera-feed') as HTMLVideoElement; if (cf) cf.srcObject = null;
    document.getElementById('camera-overlay')?.classList.add('hidden');
}
function capturePhoto() {
    const cf = document.getElementById('camera-feed') as HTMLVideoElement; if (!cf || !state.cameraStream) return;
    const c = document.createElement('canvas'); c.width = cf.videoWidth; c.height = cf.videoHeight;
    c.getContext('2d')?.drawImage(cf, 0, 0); const d = c.toDataURL('image/jpeg', 0.95);
    state.mediaType = 'image'; state.capturedFrames = [{ data: d.split(',')[1], mimeType: 'image/jpeg', src: d }];
    showImagePreview(d); enableGenerate(true); document.getElementById('edit-section')?.classList.remove('hidden'); closeCamera();
}
async function extractVideoFrames() {
    const v = document.getElementById('video-preview') as HTMLVideoElement;
    const s = document.getElementById('frame-slider') as HTMLInputElement;
    if (!v?.duration) return; setLoading(true, "Extrayendo...");
    const n = parseInt(s?.value||'10'); const iv = v.duration/n;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext('2d'); if (!ctx) return; state.capturedFrames = [];
    for (let i=0;i<n;i++) { v.currentTime=i*iv; await new Promise(r=>v.addEventListener('seeked',r,{once:true})); ctx.drawImage(v,0,0); const d=c.toDataURL('image/jpeg',0.85); state.capturedFrames.push({data:d.split(',')[1],mimeType:'image/jpeg',src:d}); }
    setLoading(false); v.classList.add('hidden'); document.getElementById('video-controls')?.classList.add('hidden');
    const ip = document.getElementById('image-preview') as HTMLImageElement;
    ip.classList.remove('hidden'); startAnimation(ip,state.capturedFrames); enableGenerate(true); document.getElementById('edit-section')?.classList.remove('hidden');
}
function startAnimation(el: HTMLImageElement, frames: CapturedFrame[], fps=5) {
    if (state.previewInterval) clearInterval(state.previewInterval); let i=0;
    state.previewInterval = window.setInterval(()=>{ if(!frames[i])return; el.src=frames[i].src; i=(i+1)%frames.length; },1000/fps);
}
async function generateStyle() {
    if (IS_NATIVE && !API_KEY) { handleError(new Error('API Key no configurada')); return; }
    if (!state.capturedFrames.length) return;
    const ai = getAI(); setLoading(true,"Transformando..."); state.stylizedFrames=[];
    const style=(document.getElementById('style-select') as HTMLSelectElement)?.value||'Watercolor Painting';
    const prompt=`Transform this image into a ${style} style. Preserve the main subject.`;
    try {
        for (const frame of state.capturedFrames) {
            const r = await ai.models.generateContent({ model:MODEL_STYLIZER, contents:{parts:[{inlineData:{mimeType:frame.mimeType,data:frame.data}},{text:prompt}]}, config:{responseModalities:['image','text']} });
            const cand = r.candidates?.[0]; if (!cand) throw new Error("Sin respuesta IA");
            for (const p of cand.content.parts) { if (p.inlineData) state.stylizedFrames.push({src:`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,data:p.inlineData.data,mimeType:p.inlineData.mimeType}); }
        }
        presentResult();
    } catch(e:any){handleError(e);} finally{setLoading(false);}
}
async function handleEditImage() {
    if (IS_NATIVE && !API_KEY) { handleError(new Error('API Key no configurada')); return; }
    const pt=(document.getElementById('edit-prompt') as HTMLInputElement)?.value.trim(); if(!pt)return;
    const sf=state.stylizedFrames.length>0?state.stylizedFrames[0]:state.capturedFrames[0]; if(!sf)return;
    const ai=getAI(); setLoading(true,"Editando...");
    try {
        const r=await ai.models.generateContent({model:MODEL_EDITOR,contents:{parts:[{inlineData:{mimeType:sf.mimeType,data:sf.data}},{text:pt}]},config:{responseModalities:['image','text']}});
        const cand=r.candidates?.[0]; if(!cand)throw new Error("Fallo edicion");
        for(const p of cand.content.parts){if(p.inlineData){state.stylizedFrames=[{src:`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,data:p.inlineData.data,mimeType:p.inlineData.mimeType}];state.mediaType='image';presentResult();}}
    } catch(e:any){handleError(e);} finally{setLoading(false);}
}
function handleError(e:any){const m=e?.message||e?.toString()||'Error';console.error('[Photomaton]',m);const p=document.getElementById('output-placeholder');if(p){p.innerHTML=`<span style="color:#ff6b6b">! ${m}</span>`;p.classList.remove('hidden');}}
function updateActionButtons(){if(state.stylizedFrames.length>0){document.getElementById('download-btn')?.classList.remove('hidden');document.getElementById('export-pdf-btn')?.classList.remove('hidden');if(state.github.repo&&state.github.token)document.getElementById('sync-github-btn')?.classList.remove('hidden');}}
async function presentResult(){document.getElementById('output-placeholder')?.classList.add('hidden');document.getElementById('result-wrapper')?.classList.remove('hidden');document.getElementById('edit-section')?.classList.remove('hidden');if(state.stylizedFrames.length===1){const i=document.getElementById('result-img') as HTMLImageElement;if(i){i.src=state.stylizedFrames[0].src;i.classList.remove('hidden');}document.getElementById('result-video')?.classList.add('hidden');}else{await createAndPlayVideo();}updateActionButtons();}
async function createAndPlayVideo(){try{const c=document.createElement('canvas');const i=new Image();await new Promise(r=>{i.onload=r;i.src=state.stylizedFrames[0].src;});c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');if(!ctx)return;const s=c.captureStream(10);const rec=new MediaRecorder(s,{mimeType:'video/webm'});const ch:Blob[]=[];rec.ondataavailable=e=>ch.push(e.data);rec.onstop=()=>{const b=new Blob(ch,{type:'video/webm'});const u=URL.createObjectURL(b);const v=document.getElementById('result-video') as HTMLVideoElement;if(v){v.src=u;v.classList.remove('hidden');}document.getElementById('result-img')?.classList.add('hidden');};rec.start();for(const f of state.stylizedFrames){await new Promise(r=>{i.onload=()=>{ctx.drawImage(i,0,0);r(null);};i.src=f.src;});await new Promise(r=>setTimeout(r,100));}rec.stop();}catch(e){console.error("Video error",e);}}
function setLoading(a:boolean,t?:string){const l=document.getElementById('loader');const lt=document.getElementById('loader-text');if(a){l?.classList.remove('hidden');if(lt&&t)lt.textContent=t;enableGenerate(false);document.getElementById('output-placeholder')?.classList.add('hidden');}else{l?.classList.add('hidden');enableGenerate(true);}}
function handleDownload(){const l=document.createElement('a');if(state.mediaType==='image'||state.stylizedFrames.length===1){l.href=state.stylizedFrames[0].src;l.download=`art-${Date.now()}.png`;}else{const v=document.getElementById('result-video') as HTMLVideoElement;l.href=v.src;l.download=`art-vid-${Date.now()}.webm`;}l.click();}
async function handleExportPDF(){if(!state.stylizedFrames.length)return;const{jsPDF}=(window as any).jspdf;const doc=new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});const pw=doc.internal.pageSize.getWidth();const m=10;const aw=pw-(m*2);for(let i=0;i<state.stylizedFrames.length;i++){if(i>0)doc.addPage();const f=state.stylizedFrames[i];const img=new Image();await new Promise(r=>{img.onload=r;img.src=f.src;});doc.addImage(f.src,'PNG',m,m,aw,aw*(img.height/img.width));}doc.save(`export-${Date.now()}.pdf`);}
init();
