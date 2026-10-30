# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Parear Caderno
# @raycast.mode silent
# @raycast.platform windows
# @raycast.argument1 { "type": "password", "placeholder": "Código de 10 dígitos mostrado no Caderno" }

# Optional parameters:
# @raycast.icon ./assets/icon.png
# @raycast.packageName Caderno
# @raycast.description Autoriza este usuário do Windows por meio de um código temporário do app.

param([string]$Code = '')

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'support/CadernoBridge.psm1') -Force

try {
  Connect-CadernoRaycast -Code $Code
  Write-Output 'Raycast pareado com o Caderno neste usuário do Windows.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
