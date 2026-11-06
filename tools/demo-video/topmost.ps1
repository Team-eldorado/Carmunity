param([int]$On = 1)
# 녹화용 Chrome 창(기본 모니터 안, 제목이 Carmunity)을 맨 위로 고정/해제
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class TW { public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
public struct RECT { public int L,T,R,B; } }
"@
$flag = if ($On -eq 1) { [IntPtr](-1) } else { [IntPtr](-2) }
$n = 0
[TW]::EnumWindows({ param($h, $l)
  if ([TW]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256; [void][TW]::GetWindowText($h, $sb, 256); $t = $sb.ToString()
    $r = New-Object TW+RECT; [void][TW]::GetWindowRect($h, [ref]$r)
    if ($t -like 'Carmunity*' -and $r.L -ge -20 -and $r.L -lt 1910 -and $r.T -ge -20 -and $r.T -lt 1030) {
      [void][TW]::SetWindowPos($h, $flag, 0, 0, 0, 0, 0x0013); $script:n++
    }
  }
  return $true }, [IntPtr]::Zero) | Out-Null
"topmost($On): $n windows"
