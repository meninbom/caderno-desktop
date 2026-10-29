param(
  [string]$OutPath = "evidence\capture.png"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$p = Get-Process electron | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no-electron-window"; exit 1 }
$h = $p.MainWindowHandle
# Torna a janela topmost na posição para não haver sobreposição de outros apps
$HWND_TOPMOST = [IntPtr](-1)
$SWP_NOSIZE = 0x1; $SWP_SHOWWINDOW = 0x40
[Win32Cap]::SetWindowPos($h, $HWND_TOPMOST, 60, 60, 0, 0, $SWP_NOSIZE -bor $SWP_SHOWWINDOW) | Out-Null
Start-Sleep -Milliseconds 900
$r = New-Object Win32Cap+RECT
[Win32Cap]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save((Join-Path (Get-Location) $OutPath), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved=${w}x${ht} $OutPath"
