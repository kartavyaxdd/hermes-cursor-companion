using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// A single 24 x 24 native surface. No input hooks, Chromium drawing, or IPC per move.
internal sealed class CursorDot : NativeWindow, IDisposable
{
    private const int Size = 24;
    private const int WM_TIMER = 0x0113, WM_CLOSE = 0x0010, WM_DESTROY = 0x0002;
    private const int WM_VISIBILITY = 0x8001;
    private const int WS_POPUP = unchecked((int)0x80000000);
    private const int WS_EX_LAYERED = 0x80000, WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000;
    private const uint SWP_NOSIZE = 0x0001, SWP_NOACTIVATE = 0x0010;
    private const uint SWP_NOOWNERZORDER = 0x0200, SWP_NOSENDCHANGING = 0x0400;
    private static readonly IntPtr Topmost = new IntPtr(-1);
    private bool requestedVisible;
    private bool isVisible;
    private Point last = new Point(int.MinValue, int.MinValue);
    private bool disposed;

    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential)] private struct SIZE { public int X, Y; public SIZE(int x, int y) { X = x; Y = y; } }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] private struct BLENDFUNCTION { public byte Op, Flags, Alpha, Format; }
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);
    [DllImport("user32.dll")] private static extern IntPtr SetTimer(IntPtr hwnd, UIntPtr id, uint interval, IntPtr callback);
    [DllImport("user32.dll")] private static extern bool KillTimer(IntPtr hwnd, UIntPtr id);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr screen, ref POINT dst, ref SIZE size, IntPtr source, ref POINT src, int key, ref BLENDFUNCTION blend, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);

    [STAThread]
    private static int Main(string[] args)
    {
        int parentId;
        if (args.Length != 2 || args[0] != "--parent" || !int.TryParse(args[1], out parentId)) return 2;
        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2: physical positions on every monitor.
            Application.EnableVisualStyles();
            using (Process parent = Process.GetProcessById(parentId))
            using (CursorDot dot = new CursorDot())
            {
                IntPtr hwnd = dot.Handle;
                Thread lifetime = new Thread(delegate() {
                    try { parent.WaitForExit(); } catch { }
                    PostMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                });
                lifetime.IsBackground = true;
                lifetime.Start();
                Thread input = new Thread(delegate() {
                    try
                    {
                        using (StreamReader reader = new StreamReader(Console.OpenStandardInput()))
                        {
                            string line;
                            while ((line = reader.ReadLine()) != null)
                            {
                                if (line == "quit") break;
                                if (line == "show" || line == "hide")
                                    PostMessage(hwnd, WM_VISIBILITY, new IntPtr(line == "show" ? 1 : 0), IntPtr.Zero);
                            }
                        }
                    }
                    catch { }
                    PostMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                });
                input.IsBackground = true;
                input.Start();
                Application.Run();
            }
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }

    private CursorDot()
    {
        CreateParams cp = new CreateParams();
        cp.Caption = "Hermes cursor dot";
        cp.Style = WS_POPUP;
        cp.ExStyle = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        cp.X = 0; cp.Y = 0; cp.Width = Size; cp.Height = Size;
        CreateHandle(cp);
        PaintOnce();
        SetWindowDisplayAffinity(Handle, 0x11); // WDA_EXCLUDEFROMCAPTURE, Windows 10 2004 and later.
        ShowWindow(Handle, 0); // Consume a parent's hidden STARTUPINFO before a later SW_SHOWNOACTIVATE.
    }

    private void PaintOnce()
    {
        IntPtr screen = GetDC(IntPtr.Zero);
        IntPtr memory = CreateCompatibleDC(screen);
        IntPtr image = IntPtr.Zero, previous = IntPtr.Zero;
        try
        {
            using (Bitmap bitmap = new Bitmap(Size, Size, PixelFormat.Format32bppPArgb))
            {
                using (Graphics g = Graphics.FromImage(bitmap))
                {
                    g.Clear(Color.Transparent);
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    // A restrained, translucent glass dot with a thin light rim.
                    using (SolidBrush body = new SolidBrush(Color.FromArgb(108, 138, 144, 151)))
                        g.FillEllipse(body, 7, 7, 10, 10);
                    using (Pen rim = new Pen(Color.FromArgb(95, 255, 255, 255), 0.8f))
                        g.DrawEllipse(rim, 7, 7, 10, 10);
                }
                image = bitmap.GetHbitmap(Color.FromArgb(0));
            }
            previous = SelectObject(memory, image);
            POINT src = new POINT(0, 0), dst = new POINT(0, 0);
            SIZE size = new SIZE(Size, Size);
            BLENDFUNCTION blend = new BLENDFUNCTION { Op = 0, Flags = 0, Alpha = 255, Format = 1 };
            if (!UpdateLayeredWindow(Handle, screen, ref dst, ref size, memory, ref src, 0, ref blend, 2))
                throw new InvalidOperationException("Could not create cursor dot surface.");
        }
        finally
        {
            if (previous != IntPtr.Zero) SelectObject(memory, previous);
            if (image != IntPtr.Zero) DeleteObject(image);
            if (memory != IntPtr.Zero) DeleteDC(memory);
            if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
        }
    }

    private void UpdatePosition()
    {
        if (!requestedVisible) return;
        POINT cursor;
        if (!GetCursorPos(out cursor))
        {
            if (isVisible) { ShowWindow(Handle, 0); isVisible = false; }
            return;
        }
        if (last.X != cursor.X || last.Y != cursor.Y || !isVisible)
        {
            // Center of the dot is 18 physical pixels down/right from the pointer.
            SetWindowPos(Handle, Topmost, cursor.X + 6, cursor.Y + 6, 0, 0,
                SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING);
            last = new Point(cursor.X, cursor.Y);
            if (!isVisible) { ShowWindow(Handle, 4); isVisible = true; } // SW_SHOWNOACTIVATE
        }
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == WM_TIMER) { UpdatePosition(); return; }
        if (message.Msg == WM_VISIBILITY)
        {
            requestedVisible = message.WParam != IntPtr.Zero;
            if (requestedVisible) { UpdatePosition(); SetTimer(Handle, new UIntPtr(1), 10, IntPtr.Zero); }
            else { KillTimer(Handle, new UIntPtr(1)); ShowWindow(Handle, 0); isVisible = false; }
            return;
        }
        if (message.Msg == WM_CLOSE) { Dispose(); Application.ExitThread(); return; }
        if (message.Msg == WM_DESTROY) { Application.ExitThread(); return; }
        base.WndProc(ref message);
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        if (Handle != IntPtr.Zero) { KillTimer(Handle, new UIntPtr(1)); DestroyHandle(); }
    }
}
