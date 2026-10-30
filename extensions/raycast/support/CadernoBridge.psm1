$script:CadernoBaseUrl = 'http://127.0.0.1:43188/v1'
if ($env:CADERNO_QA_IPC -eq '1' -and $env:CADERNO_QA_RAYCAST_PORT -match '^\d{1,5}$') {
  $qaPort = [int]$env:CADERNO_QA_RAYCAST_PORT
  if ($qaPort -ge 1024 -and $qaPort -le 65535) {
    $script:CadernoBaseUrl = "http://127.0.0.1:$qaPort/v1"
  }
}
$script:CadernoTokenPath = Join-Path $env:LOCALAPPDATA 'Caderno/Raycast/token.dpapi'

function Save-CadernoToken {
  param([Parameter(Mandatory = $true)][string]$Token)

  if ($Token -notmatch '^[a-f0-9]{64}$') {
    throw 'O Caderno retornou uma credencial inválida.'
  }

  $directory = Split-Path -Parent $script:CadernoTokenPath
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $secureToken = ConvertTo-SecureString -String $Token -AsPlainText -Force
  $encryptedToken = ConvertFrom-SecureString -SecureString $secureToken
  $temporaryPath = "$($script:CadernoTokenPath).$([guid]::NewGuid().ToString('N')).tmp"
  $backupPath = "$($script:CadernoTokenPath).$([guid]::NewGuid().ToString('N')).bak"
  try {
    [System.IO.File]::WriteAllText($temporaryPath, $encryptedToken, [System.Text.Encoding]::ASCII)
    if ([System.IO.File]::Exists($script:CadernoTokenPath)) {
      [System.IO.File]::Replace($temporaryPath, $script:CadernoTokenPath, $backupPath)
      [System.IO.File]::Delete($backupPath)
    } else {
      [System.IO.File]::Move($temporaryPath, $script:CadernoTokenPath)
    }
  } finally {
    try {
      [System.IO.File]::Delete($temporaryPath)
      [System.IO.File]::Delete($backupPath)
    } finally {
      $secureToken.Dispose()
    }
  }
}

function Get-CadernoToken {
  if (-not [System.IO.File]::Exists($script:CadernoTokenPath)) {
    throw 'Pareie o Raycast em Configurações → Raycast no Caderno.'
  }

  $encryptedToken = [System.IO.File]::ReadAllText($script:CadernoTokenPath)
  if ($encryptedToken.Length -gt 8192) {
    throw 'A credencial local está inválida. Pareie o Raycast novamente.'
  }

  try {
    $secureToken = ConvertTo-SecureString -String $encryptedToken
    $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secureToken)
    try {
      $token = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($pointer)
    } finally {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
      $secureToken.Dispose()
    }
  } catch {
    throw 'A credencial local não pode ser descriptografada por este usuário do Windows. Pareie novamente.'
  }

  if ($token -notmatch '^[a-f0-9]{64}$') {
    throw 'A credencial local está inválida. Pareie o Raycast novamente.'
  }
  return $token
}

function Invoke-CadernoApi {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body,
    [switch]$Pairing
  )

  $headers = @{}
  if (-not $Pairing) {
    $token = Get-CadernoToken
    $headers.Authorization = "Bearer $token"
  }

  $request = @{
    Uri = "$script:CadernoBaseUrl$Path"
    Method = $Method
    Headers = $headers
    TimeoutSec = 5
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $request.ContentType = 'application/json; charset=utf-8'
    $request.Body = ConvertTo-Json -InputObject $Body -Compress -Depth 5
  }

  try {
    return Invoke-RestMethod @request
  } catch {
    $code = $null
    try {
      $errorJson = $_.ErrorDetails.Message | ConvertFrom-Json
      $code = $errorJson.error
    } catch {
      # A mensagem de transporte não é exibida porque pode conter detalhes locais.
    }

    switch ($code) {
      'UNAUTHORIZED' { throw 'O acesso foi revogado ou expirou. Gere um novo código no Caderno e pareie novamente.' }
      'TOKEN_EXPIRED' { throw 'O pareamento expirou. Gere um novo código no Caderno e pareie novamente.' }
      'PAIRING_EXPIRED_OR_INVALID' { throw 'Código incorreto, expirado ou já usado. Gere outro no Caderno.' }
      'BROWSER_REQUEST_NOT_ALLOWED' { throw 'O Caderno recusou uma chamada com cabeçalhos de navegador.' }
      'NOTE_NOT_FOUND' { throw 'A nota não existe mais ou está na lixeira.' }
      'INVALID_NOTE' { throw 'Confira o título e o conteúdo da nota.' }
      'INVALID_TASK' { throw 'Confira o título, a nota e a prioridade da tarefa.' }
      'LOOPBACK_ONLY' { throw 'A ponte local recusou uma origem de rede que não é este computador.' }
      default { throw 'Não foi possível chamar o Caderno. Abra o app e confira Configurações → Raycast.' }
    }
  } finally {
    if ($headers.ContainsKey('Authorization')) {
      $headers.Authorization = $null
      $headers.Clear()
    }
    $token = $null
    $request = $null
  }
}

function Connect-CadernoRaycast {
  param([Parameter(Mandatory = $true)][string]$Code)

  if ($Code -notmatch '^\d{10}$') {
    throw 'O código de pareamento precisa ter dez números.'
  }

  $result = Invoke-CadernoApi -Method POST -Path '/pair' -Body @{ code = $Code } -Pairing
  Save-CadernoToken -Token ([string]$result.token)
}

function Remove-CadernoRaycastToken {
  [System.IO.File]::Delete($script:CadernoTokenPath)
}

Export-ModuleMember -Function Invoke-CadernoApi, Connect-CadernoRaycast, Remove-CadernoRaycastToken
