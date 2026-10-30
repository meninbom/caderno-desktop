# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Apagar Pareamento Local do Caderno
# @raycast.mode silent
# @raycast.platform windows

# Optional parameters:
# @raycast.icon ./assets/icon.png
# @raycast.packageName Caderno
# @raycast.description Remove a credencial salva por este usuário do Windows.

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'support/CadernoBridge.psm1') -Force
Remove-CadernoRaycastToken
Write-Output 'Credencial removida deste usuário do Windows. Para revogação imediata no Caderno, desative a conexão em Configurações → Raycast.'
