param([switch]$Server)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DesktopInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION data; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public KEYBDINPUT keyboard;
    [FieldOffset(0)] public MOUSEINPUT mouse;
  }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
    public ushort key; public ushort scan; public uint flags; public uint time; public IntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int x; public int y; public uint data; public uint flags; public uint time; public IntPtr extra;
  }
  public static void Click(int x, int y) {
    if (!SetCursorPos(x,y)) throw new Exception("Could not position cursor");
    mouse_event(0x0002,0,0,0,UIntPtr.Zero);
    mouse_event(0x0004,0,0,0,UIntPtr.Zero);
  }
  public static void Type(string value) {
    foreach (char c in value) {
      var down = new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { scan = c, flags = 0x0004 } } };
      var up = new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { scan = c, flags = 0x0004 | 0x0002 } } };
      if (SendInput(2, new INPUT[] { down, up }, Marshal.SizeOf(typeof(INPUT))) != 2)
        throw new Exception("Text input was blocked by Windows");
    }
  }
  public static void Key(byte value) {
    keybd_event(value,0,0,UIntPtr.Zero);
    keybd_event(value,0,0x0002,UIntPtr.Zero);
  }
}
'@
[void][DesktopInput]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
function Invoke-DesktopRequest($request) {
if ($request.kind -eq 'speak') {
  if (-not $script:synthesizer) {
    Add-Type -AssemblyName System.Speech
    $script:synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  }
  $speechStream = [System.IO.MemoryStream]::new()
  try {
    $script:synthesizer.SetOutputToWaveStream($speechStream)
    $script:synthesizer.Speak(([string]$request.text).Substring(0, [Math]::Min(4000, ([string]$request.text).Length)))
    $script:synthesizer.SetOutputToNull()
    return 'data:audio/wav;base64,' + [Convert]::ToBase64String($speechStream.ToArray())
  } finally { $speechStream.Dispose() }
}
$x = [int]$request.x
$y = [int]$request.y
$point = [DesktopInput+POINT]::new()
$point.x = $x
$point.y = $y
$handle = [DesktopInput]::GetAncestor([DesktopInput]::WindowFromPoint($point), 2)
if ($handle -eq [IntPtr]::Zero) { throw 'No desktop window at the target point' }
if ($request.kind -eq 'inspect') {
  $targetProcessId = [uint32]0
  [void][DesktopInput]::GetWindowThreadProcessId($handle, [ref]$targetProcessId)
  $targetProcess = try { (Get-Process -Id $targetProcessId -ErrorAction Stop).ProcessName + '.exe' } catch { '' }
  $targetTitle = try { (Get-Process -Id $targetProcessId -ErrorAction Stop).MainWindowTitle } catch { '' }
  return [pscustomobject]@{ handle = $handle.ToInt64().ToString(); process = $targetProcess; title = $targetTitle }
}
if ([string]$request.expectedHandle -ne $handle.ToInt64().ToString()) { throw 'The target window changed; request a new step' }
if ($request.kind -eq 'click') { [DesktopInput]::Click($x,$y) }
elseif ($request.kind -eq 'type') {
  [DesktopInput]::Click($x,$y)
  Start-Sleep -Milliseconds 150
  if ([DesktopInput]::GetForegroundWindow() -ne $handle) { throw 'The target lost focus; request a new step' }
  [DesktopInput]::Type([string]$request.text)
}
elseif ($request.kind -eq 'key') {
  [DesktopInput]::Click($x,$y)
  Start-Sleep -Milliseconds 150
  if ([DesktopInput]::GetForegroundWindow() -ne $handle) { throw 'The target lost focus; request a new step' }
  $codes = @{ enter=13; tab=9; escape=27; backspace=8; up=38; down=40; left=37; right=39 }
  if (-not $codes.ContainsKey([string]$request.key)) { throw 'Unsupported key' }
  [DesktopInput]::Key([byte]$codes[[string]$request.key])
}
else { throw 'Unsupported action' }
return 'ok'
}

if ($Server) {
  [Console]::Out.WriteLine('{"ready":true}')
  while ($null -ne ($requestLine = [Console]::In.ReadLine())) {
    try {
      $request = $requestLine | ConvertFrom-Json
      $result = Invoke-DesktopRequest $request
      [Console]::Out.WriteLine((@{ id=$request.id; ok=$true; result=$result } | ConvertTo-Json -Compress -Depth 5))
    } catch {
      [Console]::Out.WriteLine((@{ id=$request.id; ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress))
    }
  }
  if ($script:synthesizer) { $script:synthesizer.Dispose() }
} else {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  Invoke-DesktopRequest $request | ConvertTo-Json -Compress
}
