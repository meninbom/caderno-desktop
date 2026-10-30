# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Criar Tarefa no Caderno
# @raycast.mode silent
# @raycast.platform windows
# @raycast.argument1 { "type": "text", "placeholder": "ID da nota" }
# @raycast.argument2 { "type": "text", "placeholder": "Descrição da tarefa" }
# @raycast.argument3 { "type": "dropdown", "placeholder": "Prioridade", "data": [{"title":"Normal","value":"normal"},{"title":"Baixa","value":"low"},{"title":"Alta","value":"high"}] }

# Optional parameters:
# @raycast.icon ./assets/icon.png
# @raycast.packageName Caderno
# @raycast.description Cria uma tarefa vinculada à nota indicada.

param(
  [string]$NoteId = '',
  [string]$Title = '',
  [string]$Priority = 'normal'
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'support/CadernoBridge.psm1') -Force

try {
  if ($NoteId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
    throw 'Informe o ID da nota listado pelo comando Buscar Notas no Caderno.'
  }
  if (-not $Title.Trim()) { throw 'Informe uma descrição para a tarefa.' }
  if ($Priority -notin @('low', 'normal', 'high')) { throw 'Escolha uma prioridade válida.' }
  $result = Invoke-CadernoApi -Method POST -Path '/tasks' -Body @{ noteId = $NoteId; title = $Title.Trim(); priority = $Priority }
  Write-Output "Tarefa criada no Caderno: $($result.title)"
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
