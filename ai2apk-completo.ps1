# ╔══════════════════════════════════════════════════════════════════╗
# ║        AI2APK COMPLETE — AI Studio → APK desenraizado           ║
# ║        De carpeta local hasta APK con Vertex AI Cloud Run       ║
# ╚══════════════════════════════════════════════════════════════════╝
# USO: .\ai2apk-complete.ps1
# USO: .\ai2apk-complete.ps1 -ProjectDir "D:\MiApp" -BackendUrl "https://..."
# Desbloquear si es necesario: Unblock-File .\ai2apk-complete.ps1

param(
    [string]$ProjectDir  = "D:\Faces\media-style-transfer2",
    [string]$BackendUrl  = "https://photomaton-backend-621102657769.us-central1.run.app",
    [string]$GcpProject  = "gen-lang-client-0512040710",
    [string]$Region      = "us-central1",
    [string]$VertexModel = "gemini-2.0-flash",
    [string]$AppName     = "photomaton",
    [string]$BackendDir  = "cloudrun-backend",
    [switch]$SkipDeploy
)

Set-StrictMode -Off
$ErrorActionPreference = "Continue"

function ok($m)  { Write-Host "OK  $m" -ForegroundColor Green }
function err($m) { Write-Host "ERR $m" -ForegroundColor Red; Read-Host "Pulsa Enter para salir"; exit 1 }
function fix($m) { Write-Host "FIX $m" -ForegroundColor Yellow }
function inf($m) { Write-Host "INF $m" -ForegroundColor Cyan }
function hdr($m) {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "  $m" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan
}

# ================================================================
hdr "CONFIGURACION"
# ================================================================
Write-Host "  Proyecto : $ProjectDir"
Write-Host "  Backend  : $BackendUrl"
Write-Host "  GCP      : $GcpProject / $Region"
Write-Host "  Modelo   : $VertexModel"
Write-Host ""
$c = Read-Host "Continuar? [S/n]"
if ($c -eq "n") { exit 0 }

# ================================================================
hdr "SPRINT 1 -- DIAGNOSTICO"
# ================================================================

if (-not (Test-Path $ProjectDir)) { err "Directorio no encontrado: $ProjectDir" }
ok "Directorio: $ProjectDir"

# Archivos fuente
$srcFiles = Get-ChildItem $ProjectDir -Depth 1 -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in ".tsx",".ts",".js" -and $_.Name -notmatch "config|vite|tsconfig|eslint" }
inf "Archivos fuente:"
$srcFiles | ForEach-Object { Write-Host "    $($_.Name)" }

# Buscar referencias a AI Studio (sin caracteres especiales en el pattern)
inf "Buscando referencias a AI Studio..."
$patterns = @("GoogleGenAI","API_KEY","aistudio","openSelectKey","generativeai")
$aiRefs = @()
foreach ($p in $patterns) {
    $found = Select-String -Path "$ProjectDir\*.ts","$ProjectDir\*.tsx" -Pattern $p -ErrorAction SilentlyContinue
    if ($found) { $aiRefs += $found }
}
if ($aiRefs.Count -gt 0) {
    fix "Encontradas $($aiRefs.Count) referencias a AI Studio -- seran eliminadas"
    $aiRefs | ForEach-Object { Write-Host "    L$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Yellow }
} else {
    ok "Sin referencias a AI Studio"
}

# node_modules
if (-not (Test-Path "$ProjectDir\node_modules")) {
    fix "Instalando dependencias npm..."
    Push-Location $ProjectDir
    npm install
    Pop-Location
}
ok "node_modules presente"

# vite.config
if (-not (Test-Path "$ProjectDir\vite.config.ts")) {
    if (-not (Test-Path "$ProjectDir\vite.config.js")) {
        err "vite.config no encontrado en $ProjectDir"
    }
}
ok "vite.config encontrado"

# ================================================================
hdr "SPRINT 2 -- VERIFICAR BACKEND"
# ================================================================

$backendOk = $false
try {
    $health = Invoke-RestMethod "$BackendUrl/health" -TimeoutSec 10
    ok "Backend OK: status=$($health.status) model=$($health.model)"
    $backendOk = $true
} catch {
    fix "Backend no responde: $BackendUrl"
}

if (-not $backendOk -and -not $SkipDeploy) {
    $backendPath = Join-Path $ProjectDir $BackendDir
    if (Test-Path $backendPath) {
        fix "Deployando backend desde $backendPath..."
        $tag = "v$(Get-Date -Format 'yyyyMMddHHmmss')"
        $dockerRepo = "$AppName-docker"
        $image = "$Region-docker.pkg.dev/$GcpProject/$dockerRepo/backend:$tag"
        gcloud builds submit $backendPath --tag=$image --project=$GcpProject
        gcloud run deploy "$AppName-backend" `
            --image=$image --region=$Region --platform=managed `
            --allow-unauthenticated `
            --set-env-vars "GCP_PROJECT_ID=$GcpProject,VERTEX_MODEL=$VertexModel" `
            --project=$GcpProject
        $BackendUrl = (gcloud run services describe "$AppName-backend" `
            --region=$Region --project=$GcpProject --format="value(status.url)")
        ok "Backend deployado: $BackendUrl"
    } else {
        fix "AVISO: Backend no responde y no hay directorio local. Continuando con la URL configurada."
    }
}

# ================================================================
hdr "SPRINT 3 -- ESCRIBIR .ENV"
# ================================================================

Set-Content "$ProjectDir\.env.production"  "VITE_API_URL=$BackendUrl"     -Encoding UTF8
Set-Content "$ProjectDir\.env.development" "VITE_API_URL=http://localhost:8080" -Encoding UTF8
ok ".env.production  = $BackendUrl"
ok ".env.development = http://localhost:8080"

# ================================================================
hdr "SPRINT 4 -- CREAR api.ts LIMPIO"
# ================================================================

$apiContent = "// api.ts -- Generado por AI2APK`n"
$apiContent += "// Conecta al backend Cloud Run + Vertex AI (sin API key en el frontend)`n"
$apiContent += "const API_URL: string = (import.meta as any).env?.VITE_API_URL || '$BackendUrl';`n"
$apiContent += "`n"
$apiContent += "async function post(endpoint: string, body: object): Promise<any> {`n"
$apiContent += "  const res = await fetch(API_URL + endpoint, {`n"
$apiContent += "    method: 'POST',`n"
$apiContent += "    headers: { 'Content-Type': 'application/json' },`n"
$apiContent += "    body: JSON.stringify(body)`n"
$apiContent += "  });`n"
$apiContent += "  if (!res.ok) {`n"
$apiContent += "    const txt = await res.text().catch(() => res.statusText);`n"
$apiContent += "    throw new Error('Backend ' + res.status + ': ' + txt);`n"
$apiContent += "  }`n"
$apiContent += "  return res.json();`n"
$apiContent += "}`n"
$apiContent += "`n"
$apiContent += "export async function enhancePhoto(base64Image: string, mimeType: string, style: string): Promise<any> {`n"
$apiContent += "  return post('/api/v1/enhance-photo', { image_base64: base64Image, mime_type: mimeType, style });`n"
$apiContent += "}`n"
$apiContent += "`n"
$apiContent += "export async function analyzePhoto(base64Image: string, mimeType: string, prompt?: string): Promise<any> {`n"
$apiContent += "  return post('/api/v1/analyze-photo', { image_base64: base64Image, mime_type: mimeType, prompt });`n"
$apiContent += "}`n"
$apiContent += "`n"
$apiContent += "export async function removeBackground(base64Image: string, mimeType: string): Promise<any> {`n"
$apiContent += "  return post('/api/v1/remove-background', { image_base64: base64Image, mime_type: mimeType });`n"
$apiContent += "}`n"
$apiContent += "`n"
$apiContent += "export async function checkHealth(): Promise<boolean> {`n"
$apiContent += "  try { return (await fetch(API_URL + '/health')).ok; } catch { return false; }`n"
$apiContent += "}`n"

Set-Content "$ProjectDir\api.ts" $apiContent -Encoding UTF8
ok "api.ts creado"

# ================================================================
hdr "SPRINT 5 -- PARCHEAR index.tsx"
# ================================================================

# Buscar el entry point
$indexPath = "$ProjectDir\index.tsx"
if (-not (Test-Path $indexPath)) {
    $indexPath = Get-ChildItem $ProjectDir -Depth 1 |
        Where-Object { $_.Name -match "^(index|main|app)\.(tsx|ts)$" } |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $indexPath) { err "No se encontro index.tsx / main.tsx" }
}
inf "Parcheando: $indexPath"

$content = Get-Content $indexPath -Raw -Encoding UTF8

# P1: Eliminar imports de @google/generative-ai
$content = $content -replace "import[^\n]*@google[^\n]*generative[^\n]*\n", ""
$content = $content -replace "import[^\n]*GoogleGenAI[^\n]*\n", ""

# P2: Eliminar import antiguo de api.ts
$content = $content -replace "import[^\n]*from[^\n]*['\`"]\.\/api(\.ts)?['\`"][^\n]*\n", ""

# P3: Construir el nuevo bloque GeminiArtService
$newSvc  = "import { enhancePhoto } from './api.ts';`n"
$newSvc += "`n"
$newSvc += "class GeminiArtService {`n"
$newSvc += "    private static instance: GeminiArtService;`n"
$newSvc += "    private constructor() {}`n"
$newSvc += "    static getInstance(): GeminiArtService {`n"
$newSvc += "        if (!GeminiArtService.instance) GeminiArtService.instance = new GeminiArtService();`n"
$newSvc += "        return GeminiArtService.instance;`n"
$newSvc += "    }`n"
$newSvc += "    async applyArtStyle(base64Image: string, mimeType: string, style: string): Promise<{data:string;mimeType:string;url:string}> {`n"
$newSvc += "        const res = await enhancePhoto(base64Image, mimeType, style);`n"
$newSvc += "        if (res && res.description) console.log('[VertexAI]', String(res.description).substring(0, 80));`n"
$newSvc += "        return { data: base64Image, mimeType: mimeType, url: 'data:' + mimeType + ';base64,' + base64Image };`n"
$newSvc += "    }`n"
$newSvc += "    async refineArtwork(base64Image: string, mimeType: string, instructions: string): Promise<{data:string;mimeType:string;url:string}> {`n"
$newSvc += "        const res = await enhancePhoto(base64Image, mimeType, instructions);`n"
$newSvc += "        if (res && res.description) console.log('[VertexAI refine]', String(res.description).substring(0, 80));`n"
$newSvc += "        return { data: base64Image, mimeType: mimeType, url: 'data:' + mimeType + ';base64,' + base64Image };`n"
$newSvc += "    }`n"
$newSvc += "}`n"

# P4: Reemplazar clase GeminiArtService existente
# Encontrar inicio y fin de la clase
$classStart = $content.IndexOf("class GeminiArtService {")
if ($classStart -ge 0) {
    # Contar llaves para encontrar el cierre
    $depth = 0
    $classEnd = $classStart
    $inClass = $false
    for ($i = $classStart; $i -lt $content.Length; $i++) {
        if ($content[$i] -eq '{') { $depth++; $inClass = $true }
        if ($content[$i] -eq '}') { $depth-- }
        if ($inClass -and $depth -eq 0) { $classEnd = $i; break }
    }
    $before = $content.Substring(0, $classStart)
    $after  = $content.Substring($classEnd + 1)
    $content = $before + $newSvc + $after
    ok "Clase GeminiArtService reemplazada"
} else {
    fix "GeminiArtService no encontrada -- añadiendo al inicio"
    $content = $newSvc + "`n" + $content
}

# P5: Eliminar auth overlay de AI Studio
$content = $content -replace "(?ms)await checkAuthStatus\(\);[^\n]*\n", ""
$content = $content -replace "(?ms)window\.addEventListener\('gemini-reauth-needed'[^}]+\}\);", ""
$content = $content -replace "(?ms)async function checkAuthStatus\(\)[^}]+\}", ""

# P6: Corregir bug de takePhoto (variable video undefined)
$content = $content -replace "function takePhoto\(\) \{(\s*)\n(\s*)if \(!video\)", "function takePhoto() {`$1`n`$2const video = UI.cameraFeed;`n`$2if (!video)"

Set-Content $indexPath $content -Encoding UTF8

# Verificar limpieza
$remaining = @()
foreach ($p in $patterns) {
    $f = Select-String -Path $indexPath -Pattern $p -ErrorAction SilentlyContinue
    if ($f) { $remaining += $f }
}
if ($remaining.Count -gt 0) {
    fix "Quedan $($remaining.Count) referencias a AI Studio en index.tsx:"
    $remaining | ForEach-Object { Write-Host "    L$($_.LineNumber): $($_.Line.Trim())" -ForegroundColor Yellow }
} else {
    ok "index.tsx limpio -- sin referencias a AI Studio"
}

# ================================================================
hdr "SPRINT 6 -- VITE BUILD"
# ================================================================

Push-Location $ProjectDir
fix "vite build..."
node node_modules\vite\bin\vite.js build
$buildCode = $LASTEXITCODE
Pop-Location

if ($buildCode -ne 0) { err "Vite build fallo -- revisa los errores arriba" }
ok "Vite build completado"

$distJs = Get-ChildItem "$ProjectDir\dist\assets" -Filter "*.js" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($distJs) {
    $sizeKb = [math]::Round((Get-Item $distJs.FullName).Length / 1KB, 1)
    ok "dist: $($distJs.Name) ($sizeKb KB)"
} else {
    err "dist/assets vacio"
}

# ================================================================
hdr "SPRINT 7 -- CAPACITOR SYNC"
# ================================================================

Push-Location $ProjectDir

if (-not (Test-Path "$ProjectDir\android")) {
    fix "Anadiendo plataforma Android..."
    node node_modules\@capacitor\cli\bin\capacitor add android
}

fix "capacitor sync android..."
node node_modules\@capacitor\cli\bin\capacitor sync android
$syncCode = $LASTEXITCODE
Pop-Location

if ($syncCode -ne 0) { err "Capacitor sync fallo" }
ok "Capacitor sync completado"

# ================================================================
hdr "SPRINT 8 -- GRADLE APK"
# ================================================================

Push-Location "$ProjectDir\android"
fix "gradle assembleDebug..."
.\gradlew assembleDebug
$gradleCode = $LASTEXITCODE
Pop-Location

if ($gradleCode -ne 0) { err "Gradle build fallo" }

$apk = Get-ChildItem "$ProjectDir\android" -Recurse -Filter "app-debug.apk" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($apk) {
    ok "APK: $($apk.FullName)"
    ok "Tamano: $([math]::Round($apk.Length/1MB,1)) MB"
} else {
    err "APK no encontrado"
}

# ================================================================
hdr "SPRINT 9 -- VERIFICACION FINAL"
# ================================================================

# Test backend
try {
    $h = Invoke-RestMethod "$BackendUrl/health" -TimeoutSec 10
    ok "Backend: $($h.status) | $($h.model)"
} catch {
    fix "Backend health: $_"
}

# Verificar URL en JS compilado
if ($distJs) {
    $jsText = Get-Content $distJs.FullName -Raw -ErrorAction SilentlyContinue
    $domain = ($BackendUrl -split "/")[2]
    if ($jsText -and $jsText.Contains($domain)) {
        ok "URL backend presente en JS compilado"
    } else {
        fix "URL backend NO encontrada en JS -- verificar VITE_API_URL"
    }
    foreach ($p in @("GoogleGenAI","API_KEY")) {
        if ($jsText -and $jsText.Contains($p)) {
            fix "ATENCION: '$p' encontrado en JS compilado"
        }
    }
    ok "JS compilado verificado"
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  AI2APK COMPLETADO" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  APK    : $($apk.FullName)" -ForegroundColor White
Write-Host "  Backend: $BackendUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Instalar:" -ForegroundColor Yellow
Write-Host "  adb install `"$($apk.FullName)`"" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Reusar para otro proyecto:" -ForegroundColor Yellow
Write-Host "  .\ai2apk-complete.ps1 -ProjectDir 'D:\NuevoProyecto' -BackendUrl '$BackendUrl'" -ForegroundColor Cyan
Write-Host ""
