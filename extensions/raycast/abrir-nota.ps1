# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Abrir Nota no Caderno
# @raycast.mode silent
# @raycast.platform windows
# @raycast.argument1 { "type": "text", "placeholder": "ID da nota" }

# Optional parameters:
# @raycast.icon ./assets/icon.png
# @raycast.packageName Caderno
# @raycast.description Abre e seleciona no app uma nota encontrada pelo comando de busca.

param([string]$NoteId = '')

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'support/CadernoBridge.psm1') -Force

try {
  if ($NoteId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    throw 'Informe o ID de uma nota listado pelo comando Buscar Notas no Caderno.'
  }
  Invoke-CadernoApi -Method POST -Path '/notes/open' -Body @{ id = $NoteId } | Out-Null
  Write-Output 'Nota aberta no Caderno.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
