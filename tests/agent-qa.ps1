param([switch]$HostWindow, [string]$StatePath)
$ErrorActionPreference = 'Stop'
$act = Join-Path $PSScriptRoot '..\windows\act.ps1'

if ($HostWindow) {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class QaDpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command); }'
  [void][QaDpi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
  Add-Type -AssemblyName System.Windows.Forms
  $form = [System.Windows.Forms.Form]::new()
  $form.Text = 'Hermes disposable QA'
  $form.StartPosition = 'Manual'
  $form.Location = [System.Drawing.Point]::new(240, 180)
  $form.Size = [System.Drawing.Size]::new(360, 230)
  $form.TopMost = $true
  $inputBox = [System.Windows.Forms.TextBox]::new()
  $inputBox.Location = [System.Drawing.Point]::new(35, 45)
  $inputBox.Size = [System.Drawing.Size]::new(280, 28)
  $button = [System.Windows.Forms.Button]::new()
  $button.Text = 'Harmless click'
  $button.Location = [System.Drawing.Point]::new(35, 100)
  $button.Size = [System.Drawing.Size]::new(140, 34)
  $script:clicks = 0
  $script:lastKey = ''
  function Save-State {
    [pscustomobject]@{ ready = $true; clicks = $script:clicks; text = $inputBox.Text; key = $script:lastKey;
      buttonX = $button.PointToScreen([System.Drawing.Point]::new(70,17)).X;
      buttonY = $button.PointToScreen([System.Drawing.Point]::new(70,17)).Y;
      inputX = $inputBox.PointToScreen([System.Drawing.Point]::new(70,12)).X;
      inputY = $inputBox.PointToScreen([System.Drawing.Point]::new(70,12)).Y } | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatePath
  }
  $button.Add_Click({ $script:clicks++; Save-State })
  $inputBox.Add_TextChanged({ Save-State })
  $inputBox.Add_KeyDown({ param($sender,$event) $script:lastKey = $event.KeyCode.ToString(); Save-State })
  $form.Controls.AddRange(@($inputBox,$button))
  $form.Add_Shown({ [void][QaDpi]::ShowWindow($form.Handle, 5); $form.Activate(); Save-State })
  [System.Windows.Forms.Application]::Run($form)
  exit
}

$stateFile = Join-Path $PSScriptRoot 'qa-state.json'
$errorFile = Join-Path $PSScriptRoot 'qa-host-error.txt'
$hostProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'-HostWindow','-StatePath',"`"$stateFile`"") -PassThru -WindowStyle Hidden -RedirectStandardError $errorFile
try {
  for ($i=0; $i -lt 30 -and !(Test-Path -LiteralPath $stateFile); $i++) { Start-Sleep -Milliseconds 200 }
  if (!(Test-Path -LiteralPath $stateFile)) { throw "QA window did not start: $(Get-Content -LiteralPath $errorFile -Raw -ErrorAction SilentlyContinue)" }
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  function Invoke-Action($request) {
    $result = $request | ConvertTo-Json -Compress | powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $act
    if ($LASTEXITCODE -ne 0) { throw "Desktop helper exited with code $LASTEXITCODE" }
    return $result
  }
  $buttonTarget = Invoke-Action @{ kind='inspect'; x=$state.buttonX; y=$state.buttonY } | ConvertFrom-Json
  if ($buttonTarget.process -ne 'powershell.exe') { throw "QA button target was $($buttonTarget.process), not the disposable window" }
  Invoke-Action @{ kind='click'; x=$state.buttonX; y=$state.buttonY; expectedHandle=$buttonTarget.handle } | Out-Null
  Start-Sleep -Milliseconds 300
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ($state.clicks -ne 1) { throw "Click failed: count $($state.clicks)" }
  $inputTarget = Invoke-Action @{ kind='inspect'; x=$state.inputX; y=$state.inputY } | ConvertFrom-Json
  Invoke-Action @{ kind='type'; x=$state.inputX; y=$state.inputY; text='QA'; expectedHandle=$inputTarget.handle } | Out-Null
  Start-Sleep -Milliseconds 300
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ($state.text -ne 'QA') { throw "Type failed: $($state.text)" }
  Invoke-Action @{ kind='key'; x=$state.inputX; y=$state.inputY; key='enter'; expectedHandle=$inputTarget.handle } | Out-Null
  Start-Sleep -Milliseconds 300
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if ($state.key -notin @('Enter','Return')) { throw "Key failed: $($state.key)" }
  $beforeRejectedStep = $state.clicks
  $rejected = $false
  try { Invoke-Action @{ kind='click'; x=$state.buttonX; y=$state.buttonY; expectedHandle='0' } | Out-Null } catch { $rejected = $true }
  Start-Sleep -Milliseconds 200
  $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
  if (!$rejected -or $state.clicks -ne $beforeRejectedStep) { throw "Stale target was not rejected: rejected=$rejected, clicks=$($state.clicks), prior=$beforeRejectedStep" }
  Write-Output 'DISPOSABLE QA: click, type, Enter key, and stale-target rejection passed.'
} finally {
  if (!$hostProcess.HasExited) { Stop-Process -Id $hostProcess.Id }
  Remove-Item -LiteralPath $stateFile -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $errorFile -ErrorAction SilentlyContinue
}
