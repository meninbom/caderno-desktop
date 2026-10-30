# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Buscar Notas no Caderno
# @raycast.mode fullOutput
# @raycast.platform windows
# @raycast.argument1 { "type": "text", "placeholder": "Título ou texto para buscar" }
# @raycast.argument2 { "type": "text", "placeholder": "Número do resultado para abrir (opcional)", "optional": true }

# Optional parameters:
# @raycast.icon ./assets/icon.png
# @raycast.packageName Caderno
# @raycast.description Busca notas locais e pode abrir pelo número do resultado.

param(
  [string]$Query = '',
  [string]$OpenIndex = ''
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'support/CadernoBridge.psm1') -Force

try {
  if ($Query.Length -gt 200) { throw 'A busca aceita até 200 caracteres.' }
  $encodedQuery = [Uri]::EscapeDataString($Query)
  $response = Invoke-CadernoApi -Method GET -Path "/notes?query=$encodedQuery&limit=50"
  $notes = @($response.notes)

  if ($OpenIndex) {
    if ($OpenIndex -notmatch '^\d{1,2}$') { throw 'Informe o número de um resultado da busca.' }
    $index = [int]$OpenIndex
    if ($index -lt 1 -or $index -gt $notes.Count) { throw 'Esse número não corresponde a um resultado da busca.' }
    $selected = $notes[$index - 1]
    Invoke-CadernoApi -Method POST -Path '/notes/open' -Body @{ id = [string]$selected.id } | Out-Null
    Write-Output "Nota aberta no Caderno: $($selected.title)"
    exit 0
  }

  if ($notes.Count -eq 0) {
    Write-Output 'Nenhuma nota encontrada no Caderno.'
    exit 0
  }

  Write-Output "Resultados do Caderno para: $Query"
  Write-Output ''
  for ($index = 0; $index -lt $notes.Count; $index++) {
    $note = $notes[$index]
    $number = $index + 1
    $notebook = if ($note.notebookName) { [string]$note.notebookName } else { 'Sem caderno' }
    $preview = ([string]$note.preview -replace '[\r\n]+', ' ').Trim()
    Write-Output "$number. $($note.title)  ·  $notebook"
    if ($preview) { Write-Output "   $preview" }
    Write-Output "   ID: $($note.id)"
  }
  Write-Output ''
  Write-Output 'Para abrir, execute esta busca novamente e informe o número do resultado no segundo campo.'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
