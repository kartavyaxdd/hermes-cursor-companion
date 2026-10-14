Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ForegroundWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x; public int y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@

while ($true) {
  try {
    $point = [ForegroundWindow+Point]::new()
    [void][ForegroundWindow]::GetCursorPos([ref]$point)
    $handle = [ForegroundWindow]::GetAncestor([ForegroundWindow]::WindowFromPoint($point), 2)
    $processId = [uint32]0
    [void][ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
    $titleBuffer = [System.Text.StringBuilder]::new(512)
    [void][ForegroundWindow]::GetWindowText($handle, $titleBuffer, 512)
    $processName = try { (Get-Process -Id $processId -ErrorAction Stop).ProcessName + '.exe' } catch { '' }
    [pscustomobject]@{ process = $processName; title = $titleBuffer.ToString() } | ConvertTo-Json -Compress
  } catch {
    '{"process":"","title":""}'
  }
  Start-Sleep -Milliseconds 1000
}
