Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 1024, 1024
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# Background gradient
$rect = New-Object System.Drawing.Rectangle 0, 0, 1024, 1024
$c1 = [System.Drawing.Color]::FromArgb(255, 42, 24, 16)
$c2 = [System.Drawing.Color]::FromArgb(255, 10, 6, 4)
$bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 45.0
$g.FillRectangle($bgBrush, $rect)

# Gold border
$penColor = [System.Drawing.Color]::FromArgb(200, 212, 163, 115)
$pen = New-Object System.Drawing.Pen $penColor, 12
$g.DrawRectangle($pen, 24, 24, 976, 976)

# Brushes
$cupColor = [System.Drawing.Color]::FromArgb(255, 250, 237, 205)
$cupBrush = New-Object System.Drawing.SolidBrush $cupColor
$saucerColor = [System.Drawing.Color]::FromArgb(255, 36, 22, 14)
$saucerBrush = New-Object System.Drawing.SolidBrush $saucerColor
$goldColor = [System.Drawing.Color]::FromArgb(255, 212, 163, 115)
$goldBrush = New-Object System.Drawing.SolidBrush $goldColor
$coffeeColor = [System.Drawing.Color]::FromArgb(255, 58, 29, 13)
$coffeeBrush = New-Object System.Drawing.SolidBrush $coffeeColor

# Saucer
$g.FillEllipse($saucerBrush, 180, 720, 664, 50)
$g.DrawEllipse($pen, 180, 720, 664, 50)

# Cup body
$g.FillPie($cupBrush, 260, 360, 504, 380, 0, 180)
$g.FillEllipse($cupBrush, 260, 340, 504, 80)
$g.FillEllipse($coffeeBrush, 290, 350, 444, 60)

# Handle
$handlePen = New-Object System.Drawing.Pen $cupColor, 40
$g.DrawArc($handlePen, 680, 420, 160, 180, -90, 180)

# Steam
$steamPen = New-Object System.Drawing.Pen $goldColor, 16
$steamPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$steamPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawBezier($steamPen, 420, 300, 390, 230, 430, 170, 410, 100)
$g.DrawBezier($steamPen, 512, 280, 480, 210, 520, 150, 500, 80)
$g.DrawBezier($steamPen, 600, 300, 570, 230, 610, 170, 590, 100)

# Typography
$fontTitle = New-Object System.Drawing.Font "Arial", 46, ([System.Drawing.FontStyle]::Bold)
$fontSub = New-Object System.Drawing.Font "Arial", 22, ([System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center

$g.DrawString("DINER'S CAFE", $fontTitle, $goldBrush, 512, 820, $sf)
$subColor = [System.Drawing.Color]::FromArgb(255, 168, 154, 140)
$subBrush = New-Object System.Drawing.SolidBrush $subColor
$g.DrawString("ORDERING & DELIVERY", $fontSub, $subBrush, 512, 900, $sf)

$outPath = Join-Path (Get-Location) "public\assets\app-icon-1024.png"
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "SUCCESS: $outPath"
