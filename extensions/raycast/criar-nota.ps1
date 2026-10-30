# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Criar Nota Rápida no Caderno
# @raycast.mode silent
# @raycast.platform windows
# @raycast.argument1 { "type": "text", "placeholder": "Título da nota" }
# @raycast.argument2 { "type": "text", "placeholder": "Conteúdo (opcional)", "optional": true }

# Optional parameters:
# @raycast.icon ./assets/icon.png
# @raycast.packageName Caderno
# @raycast.description Salva uma nota de texto no caderno padrão do Caderno.

param(
  [string]$Title = '',
  [string]$Content = ''
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'support/CadernoBridge.psm1') -Force

try {
  if (-not $Title.Trim()) { throw 'Informe um título para a nota.' }
  $result = Invoke-CadernoApi -Method POST -Path '/notes' -Body @{ title = $Title.Trim(); content = $Content; notebookId = $null }
  Write-Output "Nota criada no Caderno: $($result.title)"
  Write-Output "ID: $($result.id)"
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
