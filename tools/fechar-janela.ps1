Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class Fecha {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  // WM_CLOSE = 0x0010 — e o que o botao X do Windows manda.
  public static void X(IntPtr h) { PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); }
}
"@

$hwnd = [IntPtr]::new([int64]$args[0])
[Fecha]::X($hwnd)
"WM_CLOSE enviado para 0x$($args[0])"