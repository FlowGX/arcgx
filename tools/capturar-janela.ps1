Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;

public static class Janela {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  public static string Titulo(IntPtr h) {
    var sb = new System.Text.StringBuilder(512);
    GetWindowTextW(h, sb, 512);
    return sb.ToString();
  }

  // PW_RENDERFULLCONTENT = 2: desenha a janela mesmo coberta por outra.
  // Sem isso uma janela transparente e sempre-on-top volta vazia.
  public static bool Capturar(IntPtr h, string saida) {
    RECT r;
    if (!GetWindowRect(h, out r)) return false;
    int w = r.Right - r.Left, ht = r.Bottom - r.Top;
    if (w <= 0 || ht <= 0) return false;
    using (var bmp = new Bitmap(w, ht, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr dc = g.GetHdc();
      bool ok = PrintWindow(h, dc, 2);
      g.ReleaseHdc(dc);
      if (!ok) return false;
      bmp.Save(saida, System.Drawing.Imaging.ImageFormat.Png);
      return true;
    }
  }
}
"@ -ReferencedAssemblies System.Drawing

$hwnd = [IntPtr]::new([int64]$args[0])
$saida = $args[1]

if (-not [Janela]::IsWindowVisible($hwnd)) { "janela invisivel"; exit 1 }
"titulo: $([Janela]::Titulo($hwnd))"
$ok = [Janela]::Capturar($hwnd, $saida)
if ($ok) { "capturado -> $saida ($((Get-Item $saida).Length) bytes)" } else { "falhou" }