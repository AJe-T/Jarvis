// PowerShell scripts used by native tools. They read parameters from $P (JSON passed via an
// environment variable by runPowerShell), so no tool input is ever spliced into script text.

/** Core Audio (IAudioEndpointVolume) interop for absolute volume and mute (API-Guide.md §2.3). */
const AUDIO_TYPE = `
if (-not ('JarvisAudio' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float l, Guid g); int SetMasterVolumeLevelScalar(float l, Guid g);
  int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
  int SetChannelVolumeLevel(uint c, float l, Guid g); int SetChannelVolumeLevelScalar(uint c, float l, Guid g);
  int GetChannelVolumeLevel(uint c, out float l); int GetChannelVolumeLevelScalar(uint c, out float l);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f, int s, out IntPtr d); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }
public static class JarvisAudio {
  static IAudioEndpointVolume Vol() {
    var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d));
    var iid = typeof(IAudioEndpointVolume).GUID; object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref iid, 23, IntPtr.Zero, out o));
    return (IAudioEndpointVolume)o;
  }
  public static float Get() { float v; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static void Set(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(v, Guid.Empty)); }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void Mute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, Guid.Empty)); }
}
'@
}`;

export const PS_SET_VOLUME = `${AUDIO_TYPE}
[JarvisAudio]::Set([float]($P.level / 100)); if ($P.level -gt 0) { [JarvisAudio]::Mute($false) }
@{ level = [math]::Round([JarvisAudio]::Get() * 100) } | ConvertTo-Json -Compress`;

export const PS_SET_MUTE = `${AUDIO_TYPE}
$target = if ($null -eq $P.muted) { -not [JarvisAudio]::Muted() } else { [bool]$P.muted }
[JarvisAudio]::Mute($target)
@{ muted = [JarvisAudio]::Muted() } | ConvertTo-Json -Compress`;

export const PS_SET_BRIGHTNESS = `
$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue
if (-not $m) { @{ supported = $false } | ConvertTo-Json -Compress; exit 0 }
$m | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$P.level } | Out-Null
@{ supported = $true; level = $P.level } | ConvertTo-Json -Compress`;

export const PS_BATTERY = `
$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $b) { @{ present = $false } | ConvertTo-Json -Compress; exit 0 }
@{ present = $true; percent = $b.EstimatedChargeRemaining; status = $b.BatteryStatus; minutes = $b.EstimatedRunTime } | ConvertTo-Json -Compress`;

export const PS_SLEEP = `Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false) | Out-Null`;

export const PS_START_APPS = `Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress`;

export const PS_LIST_WINDOWS = `
Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress`;

const USER32 = `
if (-not ('JarvisWin' -as [type])) {
Add-Type -Name JarvisWin -Namespace J -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, System.UIntPtr e);
'@
}`;

/** $P.pid and $P.action ('focus' | 'minimize' | 'maximize'). */
export const PS_WINDOW_ACTION = `${USER32}
$p = Get-Process -Id $P.pid -ErrorAction Stop
$h = $p.MainWindowHandle
switch ($P.action) {
  'minimize' { [J.JarvisWin]::ShowWindow($h, 6) | Out-Null }
  'maximize' { [J.JarvisWin]::ShowWindow($h, 3) | Out-Null; [J.JarvisWin]::SetForegroundWindow($h) | Out-Null }
  default {
    if ([J.JarvisWin]::IsIconic($h)) { [J.JarvisWin]::ShowWindow($h, 9) | Out-Null }
    # Pressing Alt lets a background process take the foreground (Windows focus-stealing rules).
    [J.JarvisWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [J.JarvisWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    [J.JarvisWin]::SetForegroundWindow($h) | Out-Null
  }
}
@{ ok = $true; title = $p.MainWindowTitle } | ConvertTo-Json -Compress`;

/** $P.ids: process ids whose main windows should close gracefully. */
export const PS_CLOSE_WINDOWS = `
$closed = @()
foreach ($id in $P.ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p -and $p.CloseMainWindow()) { $closed += $p.ProcessName } }
@{ closed = $closed } | ConvertTo-Json -Compress`;

/** $P.ids: process ids to stop. */
export const PS_STOP_PROCESSES = `
$stopped = @()
foreach ($id in $P.ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id $id -ErrorAction SilentlyContinue; $stopped += $p.ProcessName } }
@{ stopped = $stopped } | ConvertTo-Json -Compress`;

export const PS_PROCESSES = `Get-Process | Select-Object Id, ProcessName, MainWindowTitle | ConvertTo-Json -Compress`;
