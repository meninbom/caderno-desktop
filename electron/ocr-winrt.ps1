param(
  [string]$ImagePath,
  [string]$PdfPath,
  [string]$PageNumbers,
  [int]$PageCount = 0
)
$ErrorActionPreference = 'Stop'

function Wait-WinRT($operation, [Type]$resultType, [string]$label) {
  $task = $script:asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(60000)) { throw "Tempo limite aguardando $label (60 s)." }
  return $task.Result
}
function Wait-WinRTAction($operation, [string]$label) {
  $task = $script:asTaskAction.Invoke($null, @($operation))
  if (-not $task.Wait(60000)) { throw "Tempo limite aguardando $label (60 s)." }
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
  $script:asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
  $script:asTaskAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) {
    $available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) -join ', '
    if (-not $available) { $available = 'nenhum pacote de reconhecimento WinRT disponível' }
    throw "Windows.Media.Ocr sem idioma reconhecedor configurado no perfil do usuário. Idiomas WinRT disponíveis: $available. Instale o idioma OCR pelo Windows e tente novamente. Nenhum pacote foi baixado automaticamente."
  }

  if ($PdfPath) {
    $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]
    $null = [Windows.Data.Pdf.PdfPage, Windows.Data.Pdf, ContentType=WindowsRuntime]
    $file = Wait-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($PdfPath)) ([Windows.Storage.StorageFile]) 'leitura do PDF'
    $document = Wait-WinRT ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument]) 'abertura do PDF'
    if ($document.PageCount -gt 500) { throw 'PDF excede o limite de 500 páginas.' }
    if ($PageCount -gt 0 -and $document.PageCount -ne $PageCount) { throw 'O número de páginas do PDF mudou durante a extração.' }
    $targets = @($PageNumbers -split ',' | Where-Object { $_ } | ForEach-Object { [int]$_ })
    $totalPixels = [int64]0
    $done = 0
    foreach ($pageNo in $targets) {
      if ($pageNo -lt 1 -or $pageNo -gt $document.PageCount) { throw 'Página OCR fora do intervalo do PDF.' }
      $page = $document.GetPage([uint32]($pageNo - 1))
      $width = [double]$page.Size.Width; $height = [double]$page.Size.Height
      if ($width -le 0 -or $height -le 0) { throw "Dimensões inválidas na página $pageNo." }
      $scale = [Math]::Min(2.0, [Math]::Min(10000.0 / $width, 10000.0 / $height))
      $pixelWidth = [Math]::Max(1, [int][Math]::Ceiling($width * $scale))
      $pixelHeight = [Math]::Max(1, [int][Math]::Ceiling($height * $scale))
      $pixels = [int64]$pixelWidth * [int64]$pixelHeight
      if ($pixels -gt 40000000) { throw "Página $pageNo excede o limite OCR de 40 MP." }
      $totalPixels += $pixels
      if ($totalPixels -gt 200000000) { throw 'PDF excede o limite OCR acumulado de 200 MP.' }
      $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $options.DestinationWidth = [uint32]$pixelWidth
      $options.DestinationHeight = [uint32]$pixelHeight
      $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      Wait-WinRTAction ($page.RenderToStreamAsync($stream, $options)) "renderização da página $pageNo"
      $stream.Seek(0)
      $decoder = Wait-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]) "decodificação da página $pageNo"
      if ([int64]$decoder.PixelWidth * [int64]$decoder.PixelHeight -gt 40000000) { throw "Renderização da página $pageNo excede o limite de 40 MP." }
      $bitmap = Wait-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]) "bitmap da página $pageNo"
      $result = Wait-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]) "OCR da página $pageNo"
      $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$result.Text))
      [Console]::Out.WriteLine("OCR_PAGE:${pageNo}:$encoded")
      $done++; [Console]::Out.WriteLine("OCR_PROGRESS:${done}:${pageNo}:$($targets.Count)")
      $bitmap.Dispose(); $stream.Dispose(); $page.Dispose()
    }
  } else {
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $file = Wait-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile]) 'leitura da imagem'
    $stream = Wait-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream]) 'abertura da imagem'
    $decoder = Wait-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]) 'decodificação da imagem'
    if ($decoder.PixelWidth -gt 10000 -or $decoder.PixelHeight -gt 10000 -or ([int64]$decoder.PixelWidth * [int64]$decoder.PixelHeight) -gt 40000000) { throw 'Imagem excede limite OCR de 10000 px ou 40 MP.' }
    $bitmap = Wait-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]) 'bitmap da imagem'
    $result = Wait-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]) 'OCR da imagem'
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$result.Text))
    [Console]::Out.WriteLine('OCR_RESULT_BASE64:' + $encoded)
    $bitmap.Dispose(); $stream.Dispose()
  }
} catch {
  [Console]::Error.WriteLine('OCR_WINRT_ERROR: ' + $_.Exception.ToString())
  exit 2
}
