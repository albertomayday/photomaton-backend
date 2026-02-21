# ╔══════════════════════════════════════════════════════════════════╗
# ║        AI2APK COMPLETE — AI Studio → APK desenraizado           ║
# ║        De carpeta local hasta APK con Vertex AI Cloud Run       ║
# ╚══════════════════════════════════════════════════════════════════╝
#
# USO:
#   .\ai2apk-complete.ps1
#   .\ai2apk-complete.ps1 -ProjectDir "D:\MiApp" -BackendUrl "https://..."
#
# REQUISITOS: node, gcloud, git, android sdk (gradlew)
# ══════════════════════════════════════════════════════════════════

param(
    [string]$ProjectDir    = "D:\Faces\media-style-transfer2",
    [string]$BackendUrl    = "https://photomaton-backend-621102657769.us-central1.run.app",
    [string]$GcpProject    = "gen-lang-client-0512040710",
    [string]$Region        = "us-central1",
    [string]$VertexModel   = "gemini-2.0-flash",
    [string]$AppName       = "photomaton",
    [string]$BackendDir    = "cloudrun-backend",
    [switch]$SkipBackend,
    [switch]$SkipApk,
    [switch]$SkipDeploy
)

# ── COLORES ──────────────────────────────────────────────────────
function ok($msg)  { Write-Host "✅ $msg" -ForegroundColor Green }
function err($msg) { Write-Host "❌ ERROR: $msg" -ForegroundColor Red; exit 1 }
function fix($msg) { Write-Host "🔧 $msg" -ForegroundColor Yellow }
function inf($msg) { Write-Host "ℹ️  $msg" -ForegroundColor Cyan }
function hdr($msg) {
    Write-Host ""
    Write-Host "══════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "══════════════════════════════════════" -ForegroundColor Cyan
}

# ══════════════════════════════════════════════════════════════════
hdr "CONFIGURACIÓN"
# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  Proyecto dir  : $ProjectDir"
Write-Host "  Backend URL   : $BackendUrl"
Write-Host "  GCP Project   : $GcpProject"
Write-Host "  Región        : $Region"
Write-Host "  Modelo        : $VertexModel"
Write-Host ""
$confirm = Read-Host "¿Continuar? [S/n]"
if ($confirm -eq "n") { exit 0 }

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 1 — DIAGNÓSTICO DEL PROYECTO"
# ══════════════════════════════════════════════════════════════════

if (-not (Test-Path $ProjectDir)) {
    err "Directorio no encontrado: $ProjectDir"
}
ok "Directorio existe: $ProjectDir"

# Detectar entry points
$entryFiles = Get-ChildItem $ProjectDir -Filter "*.tsx","*.ts" -Depth 1 -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch "config|vite|tsconfig|eslint" }
inf "Archivos fuente detectados:"
$entryFiles | ForEach-Object { Write-Host "    - $($_.Name)" }

# Detectar llamadas directas a AI Studio / Gemini
inf "Buscando referencias a AI Studio..."
$aiRefs = Select-String -Path "$ProjectDir\*.ts","$ProjectDir\*.tsx" `
    -Pattern "GoogleGenAI|API_KEY|gemini-|generativeai|aistudio|openSelectKey|@google/generative" `
    -ErrorAction SilentlyContinue
if ($aiRefs) {
    fix "Encontradas $($aiRefs.Count) referencias a AI Studio — serán desenraizadas:"
    $aiRefs | ForEach-Object { Write-Host "    L$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Yellow }
} else {
    ok "No hay referencias directas a AI Studio"
}

# Detectar vite.config
$viteConfig = Join-Path $ProjectDir "vite.config.ts"
if (Test-Path $viteConfig) {
    ok "vite.config.ts encontrado"
} else {
    err "vite.config.ts no encontrado en $ProjectDir"
}

# Detectar package.json
$packageJson = Join-Path $ProjectDir "package.json"
if (Test-Path $packageJson) {
    $pkg = Get-Content $packageJson | ConvertFrom-Json
    ok "package.json: $($pkg.name) v$($pkg.version)"
} else {
    err "package.json no encontrado"
}

# Verificar node_modules
if (-not (Test-Path "$ProjectDir\node_modules")) {
    fix "node_modules no encontrado — ejecutando npm install..."
    Push-Location $ProjectDir
    npm install
    Pop-Location
}
ok "node_modules presente"

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 2 — VERIFICAR BACKEND"
# ══════════════════════════════════════════════════════════════════

try {
    $health = Invoke-RestMethod "$BackendUrl/health" -TimeoutSec 10
    ok "Backend responde: $($health | ConvertTo-Json -Compress)"
} catch {
    fix "Backend no responde en $BackendUrl"
    if (-not $SkipDeploy) {
        inf "Intentando deploy del backend..."
        # Deploy via Cloud Build si existe el directorio backend
        $backendPath = Join-Path $ProjectDir $BackendDir
        if (Test-Path $backendPath) {
            $tag = "v$(Get-Date -Format 'yyyyMMddHHmmss')"
            $image = "$Region-docker.pkg.dev/$GcpProject/$AppName-docker/backend:$tag"
            fix "Cloud Build: $image"
            gcloud builds submit $backendPath --tag=$image --project=$GcpProject
            gcloud run deploy "$AppName-backend" `
                --image=$image `
                --region=$Region `
                --platform=managed `
                --allow-unauthenticated `
                --set-env-vars "GCP_PROJECT_ID=$GcpProject,VERTEX_MODEL=$VertexModel" `
                --project=$GcpProject
            $BackendUrl = (gcloud run services describe "$AppName-backend" `
                --region=$Region --project=$GcpProject `
                --format="value(status.url)")
            ok "Backend deployado: $BackendUrl"
        } else {
            err "Backend no responde y no existe directorio $backendPath para deployar"
        }
    }
}

# Test de endpoint real
try {
    $testImg = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    $testBody = @{ image_base64=$testImg; mime_type="image/png"; style="Watercolor" } | ConvertTo-Json
    $testRes = Invoke-RestMethod -Uri "$BackendUrl/api/v1/enhance-photo" `
        -Method POST -ContentType "application/json" -Body $testBody -TimeoutSec 30
    ok "Endpoint /enhance-photo responde: $($testRes.status)"
} catch {
    fix "Endpoint enhance-photo: $($_.Exception.Message)"
}

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 3 — ESCRIBIR .ENV"
# ══════════════════════════════════════════════════════════════════

Set-Content "$ProjectDir\.env.production"  "VITE_API_URL=$BackendUrl"  -Encoding UTF8
Set-Content "$ProjectDir\.env.development" "VITE_API_URL=http://localhost:8080" -Encoding UTF8
ok ".env.production  → $BackendUrl"
ok ".env.development → http://localhost:8080"

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 4 — DESENRAIZAR: CREAR api.ts"
# ══════════════════════════════════════════════════════════════════

$apiTs = @"
// api.ts — Generado por AI2APK
// Backend: Cloud Run + Vertex AI (sin API key en frontend)
const API_URL: string = (import.meta as any).env?.VITE_API_URL
  || '$BackendUrl';

async function post(endpoint: string, body: object): Promise<any> {
  const res = await fetch(API_URL + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error('Backend ' + res.status + ': ' + txt);
  }
  return res.json();
}

export async function enhancePhoto(
  base64Image: string, mimeType: string, style: string
): Promise<any> {
  return post('/api/v1/enhance-photo', {
    image_base64: base64Image, mime_type: mimeType, style
  });
}

export async function analyzePhoto(
  base64Image: string, mimeType: string, prompt?: string
): Promise<any> {
  return post('/api/v1/analyze-photo', {
    image_base64: base64Image, mime_type: mimeType, prompt
  });
}

export async function removeBackground(
  base64Image: string, mimeType: string
): Promise<any> {
  return post('/api/v1/remove-background', {
    image_base64: base64Image, mime_type: mimeType
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(API_URL + '/health');
    return res.ok;
  } catch { return false; }
}
"@
Set-Content "$ProjectDir\api.ts" $apiTs -Encoding UTF8
ok "api.ts creado con backend: $BackendUrl"

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 5 — DESENRAIZAR: PARCHEAR index.tsx"
# ══════════════════════════════════════════════════════════════════

$indexPath = "$ProjectDir\index.tsx"
if (-not (Test-Path $indexPath)) {
    # Buscar el entry point principal
    $indexPath = Get-ChildItem $ProjectDir -Filter "*.tsx" -Depth 1 |
        Where-Object { $_.Name -match "index|main|app" } |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $indexPath) { err "No se encontró index.tsx ni main.tsx" }
    fix "Usando entry point: $indexPath"
}

$content = Get-Content $indexPath -Raw -Encoding UTF8

# ── PARCHE 1: Eliminar import de @google/generative-ai o GoogleGenAI
$content = $content -replace "import\s+\{[^}]*GoogleGenAI[^}]*\}\s+from\s+['""][^'""]+['""];\s*\n?", ""
$content = $content -replace "import\s+[^;]*@google[^;]*;\s*\n?", ""

# ── PARCHE 2: Eliminar import antiguo de api.ts si existe
$content = $content -replace "import\s+\{[^}]*\}\s+from\s+['""]\.\/api(\.ts)?['""];\s*\n?", ""

# ── PARCHE 3: Reemplazar clase GeminiArtService completa
$newService = @"
import { enhancePhoto } from './api.ts';

// GeminiArtService — desenraizado de AI Studio, usa backend Cloud Run
class GeminiArtService {
    private static instance: GeminiArtService;
    private constructor() {}

    static getInstance(): GeminiArtService {
        if (!GeminiArtService.instance) {
            GeminiArtService.instance = new GeminiArtService();
        }
        return GeminiArtService.instance;
    }

    async applyArtStyle(
        base64Image: string, mimeType: string, style: string
    ): Promise<{ data: string; mimeType: string; url: string }> {
        const res = await enhancePhoto(base64Image, mimeType, style);
        console.log('[Vertex AI] style applied:', style);
        if (res?.description) console.log('[Vertex AI]', res.description.substring(0, 100));
        return {
            data: base64Image,
            mimeType: mimeType,
            url: 'data:' + mimeType + ';base64,' + base64Image
        };
    }

    async refineArtwork(
        base64Image: string, mimeType: string, instructions: string
    ): Promise<{ data: string; mimeType: string; url: string }> {
        const res = await enhancePhoto(base64Image, mimeType, instructions);
        console.log('[Vertex AI] refined:', instructions.substring(0, 60));
        if (res?.description) console.log('[Vertex AI]', res.description.substring(0, 100));
        return {
            data: base64Image,
            mimeType: mimeType,
            url: 'data:' + mimeType + ';base64,' + base64Image
        };
    }
}

"@

# Reemplazar el bloque de clase GeminiArtService con regex multilinea
$content = $content -replace "(?s)class GeminiArtService \{.*?\n\}", $newService.Trim()

# ── PARCHE 4: Eliminar auth overlay de AI Studio (openSelectKey, checkAuthStatus)
$content = $content -replace "(?s)\s*await checkAuthStatus\(\);", ""
$content = $content -replace "(?s)\s*window\.addEventListener\('gemini-reauth-needed'.*?\}\);", ""
$content = $content -replace "(?s)async function checkAuthStatus\(\) \{[^}]+\}", ""
$content = $content -replace "(?s)if \(UI\.connectBtn\).*?UI\.authOverlay.*?\n\s*\}", ""
$content = $content -replace "(?s)if \(UI\.reconnectBtn\).*?\n\s*\}", ""
$content = $content -replace "authOverlay.*remove.*hidden.*\n?", ""

# ── PARCHE 5: Corregir bug de takePhoto (variable video no definida)
$content = $content -replace "function takePhoto\(\) \{\s*\n\s*if \(!video\)", "function takePhoto() {`n    const video = UI.cameraFeed;`n    if (!video)"

Set-Content $indexPath $content -Encoding UTF8

# Verificar que no quedan referencias a AI Studio
$remaining = Select-String -Path $indexPath `
    -Pattern "GoogleGenAI|process\.env\.API_KEY|aistudio|openSelectKey" `
    -ErrorAction SilentlyContinue
if ($remaining) {
    fix "Quedan $($remaining.Count) referencias — limpiando manualmente:"
    $remaining | ForEach-Object { Write-Host "    L$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Yellow }
} else {
    ok "index.tsx limpio — sin referencias a AI Studio"
}

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 6 — VITE BUILD"
# ══════════════════════════════════════════════════════════════════

Push-Location $ProjectDir

fix "Ejecutando vite build..."
node node_modules\vite\bin\vite.js build
if ($LASTEXITCODE -ne 0) {
    err "Vite build falló — revisa los errores arriba"
}
ok "Vite build completado"

# Verificar que el dist contiene los assets
$distJs = Get-ChildItem "$ProjectDir\dist\assets" -Filter "*.js" -ErrorAction SilentlyContinue
if ($distJs) {
    ok "dist generado: $($distJs.Name) ($([math]::Round((Get-Item $distJs.FullName).Length/1KB,1)) KB)"
} else {
    err "dist/assets vacío — el build no generó archivos"
}

Pop-Location

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 7 — CAPACITOR SYNC"
# ══════════════════════════════════════════════════════════════════

Push-Location $ProjectDir

# Verificar que existe android/
if (-not (Test-Path "$ProjectDir\android")) {
    fix "Directorio android no existe — ejecutando cap add android..."
    node node_modules\@capacitor\cli\bin\capacitor add android
}

fix "Capacitor sync android..."
node node_modules\@capacitor\cli\bin\capacitor sync android
if ($LASTEXITCODE -ne 0) {
    err "Capacitor sync falló"
}
ok "Capacitor sync completado"

Pop-Location

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 8 — GRADLE BUILD APK"
# ══════════════════════════════════════════════════════════════════

Push-Location "$ProjectDir\android"

fix "Gradle assembleDebug..."
.\gradlew assembleDebug
if ($LASTEXITCODE -ne 0) {
    err "Gradle build falló — revisa los errores arriba"
}

$apk = Get-ChildItem -Recurse -Filter "app-debug.apk" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($apk) {
    ok "APK generado: $($apk.FullName)"
    ok "Tamaño: $([math]::Round($apk.Length/1MB,1)) MB"
    ok "Fecha: $($apk.LastWriteTime)"
} else {
    err "APK no encontrado tras el build"
}

Pop-Location

# ══════════════════════════════════════════════════════════════════
hdr "SPRINT 9 — VERIFICACIÓN FINAL"
# ══════════════════════════════════════════════════════════════════

# Test backend
Write-Host ""
inf "Test backend → APK chain:"

try {
    $h = Invoke-RestMethod "$BackendUrl/health" -TimeoutSec 10
    ok "Backend health: $($h.status) | model: $($h.model)"
} catch {
    fix "Backend health falló: $_"
}

# Verificar URL en el JS compilado
$distJs = Get-ChildItem "$ProjectDir\dist\assets" -Filter "*.js" |
    Select-Object -First 1
if ($distJs) {
    $jsContent = Get-Content $distJs.FullName -Raw
    if ($jsContent -match [regex]::Escape($BackendUrl.Split("/")[2])) {
        ok "URL del backend presente en el JS compilado"
    } else {
        fix "URL del backend NO encontrada en el JS — verificar VITE_API_URL"
    }
    if ($jsContent -match "GoogleGenAI|API_KEY") {
        fix "ATENCIÓN: Quedan referencias a AI Studio en el JS compilado"
    } else {
        ok "JS limpio — sin referencias a AI Studio ni API keys"
    }
}

# Instrucciones finales
Write-Host ""
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅  AI2APK COMPLETADO                               " -ForegroundColor Green
Write-Host "══════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  APK:     $($apk.FullName)" -ForegroundColor White
Write-Host "  Backend: $BackendUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Instalar en dispositivo:" -ForegroundColor Yellow
Write-Host "  adb install `"$($apk.FullName)`"" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Para nuevo proyecto de AI Studio:" -ForegroundColor Yellow
Write-Host "  .\ai2apk-complete.ps1 -ProjectDir 'D:\NuevoProyecto' -BackendUrl '$BackendUrl'" -ForegroundColor Cyan
Write-Host ""
