# Captura screenshots do Electron real em perfil isolado.
# Uso: .\scripts\capture-all.ps1
$ErrorActionPreference = "Stop"
# Remove qualquer ELECTRON_RUN_AS_NODE herdado: com ele o Electron vira Node
# puro e `require('electron').app` fica indefinido (quebra o processo principal).
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
$pop = Join-Path $env:TEMP "caderno-qa-populated"
$empty = Join-Path $env:TEMP "caderno-qa-empty"
$evDir = Join-Path $root "evidence"

function Run-Capture($name, $userData, $w, $h, $theme, $openFirst) {
  $out = Join-Path $evDir $name
  # Defina o tema no perfil de QA antes de iniciar, sem depender de um toggle
  # assíncrono ou do estado deixado pela captura anterior.
  $env:CADERNO_QA_DATABASE = Join-Path $userData "caderno.sqlite"
  $env:CADERNO_QA_THEME = $theme
  $env:ELECTRON_RUN_AS_NODE = "1"
  & $electron -e 'const D=require("better-sqlite3"),f=require("fs");const p=process.env.CADERNO_QA_DATABASE;if(f.existsSync(p)){const db=new D(p);db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)").run("theme",process.env.CADERNO_QA_THEME);db.close()}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "falha ao configurar tema do perfil QA" }
  Remove-Item Env:ELECTRON_RUN_AS_NODE
  $env:CADERNO_CAPTURE = $out
  $env:CADERNO_USER_DATA = $userData
  $env:CADERNO_WINDOW_WIDTH = "$w"
  $env:CADERNO_WINDOW_HEIGHT = "$h"
  $env:CADERNO_THEME = $theme
  $env:CADERNO_OPEN_FIRST = $openFirst
  & $electron "." 2>&1 | Out-Null
  if (-not (Test-Path $out)) { throw "captura não gerada: $name" }
  $len = (Get-Item $out).Length
  if ($len -lt 1000) { throw "captura vazia: $name ($len bytes)" }
  Write-Output "ok ${name}  ${w}x${h}  $len bytes"
}

# Populado (nota aberta), claro/escuro, 1440x900 e 1000x700
Run-Capture "v020-light-populated-1440.png" $pop 1440 900 "light" "1"
Run-Capture "v020-dark-populated-1440.png"  $pop 1440 900 "dark"  "1"
Run-Capture "v020-light-populated-1000.png" $pop 1000 700 "light" "1"
Run-Capture "v020-dark-populated-1000.png"  $pop 1000 700 "dark"  "1"

# Vazio, claro/escuro, 1440x900 e 1000x700
Run-Capture "v020-light-empty-1440.png" $empty 1440 900 "light" "0"
Run-Capture "v020-dark-empty-1440.png"  $empty 1440 900 "dark"  "0"
Run-Capture "v020-light-empty-1000.png" $empty 1000 700 "light" "0"
Run-Capture "v020-dark-empty-1000.png"  $empty 1000 700 "dark"  "0"

# Janela mínima 900x560 (sem overflow), claro populado
Run-Capture "v020-light-populated-min-900.png" $pop 900 560 "light" "1"

Write-Output "ALL-DONE"
