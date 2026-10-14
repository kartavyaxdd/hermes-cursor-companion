$ErrorActionPreference = 'Stop'
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw 'The Windows .NET Framework C# compiler is unavailable.' }
$sourcePath = Join-Path $PSScriptRoot 'cursor-dot.cs'
$targetPath = Join-Path $PSScriptRoot 'cursor-dot.exe'
if ((Test-Path -LiteralPath $targetPath) -and (Get-Item -LiteralPath $targetPath).LastWriteTimeUtc -ge (Get-Item -LiteralPath $sourcePath).LastWriteTimeUtc) {
    Write-Output 'Native cursor dot is up to date.'
    exit 0
}
& $compilerPath /nologo /target:winexe /platform:x64 /optimize+ "/out:$targetPath" /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $sourcePath
if ($LASTEXITCODE -ne 0) { throw 'Native cursor dot compilation failed.' }
Write-Output "Built $targetPath"
