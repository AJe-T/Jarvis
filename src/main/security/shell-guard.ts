// Security.md §5.2. run_powershell is always CONFIRM; this guard decides what is BLOCKED outright.
// The blocklist is deliberately broad: purpose-built tools exist for the legitimate versions.

export interface ShellVerdict {
  blocked: boolean;
  reasons: string[];
}

/** Whole PowerShell/cmd words only: "format" but not "Format-Table", "del" but not "-Delimiter". */
function w(alternatives: string): string {
  return String.raw`(?<![\w-])(?:${alternatives})(?![\w-])`;
}
const rx = (...parts: string[]): RegExp => new RegExp(parts.join(''));
const ANY = String.raw`[^;\n|]*`;
const HIVE = String.raw`(?:\bhk(?:lm|cu|cr|u|cc):|registry::)`;

const RULES: Array<{ re: RegExp; reason: string }> = [
  // Permanent deletion (use delete_to_recycle_bin instead).
  {
    re: rx(w('remove-item|ri|rm|rmdir|rd|del|erase')),
    reason: 'permanent deletion (use the Recycle Bin tool)',
  },
  {
    re: /\[(system\.)?io\.(file|directory)\]::delete|\.delete\(\)/,
    reason: 'permanent deletion via .NET',
  },
  { re: rx(w('clear-recyclebin')), reason: 'emptying the Recycle Bin' },
  // Disks, boot, encryption.
  {
    re: rx(
      w(
        'format|format-volume|clear-disk|initialize-disk|remove-partition|diskpart|bcdedit|manage-bde|disable-bitlocker',
      ),
    ),
    reason: 'disk / boot / encryption changes',
  },
  { re: /\bcipher(\.exe)?\s+\/w/, reason: 'disk wipe' },
  { re: rx(w('vssadmin|wbadmin'), '|shadowcopy'), reason: 'shadow copy / backup deletion' },
  // Registry writes.
  {
    re: rx(w('reg(?:\\.exe)?'), String.raw`\s+(add|delete|import|load|restore|copy)\b`),
    reason: 'registry write',
  },
  {
    re: rx(
      w(
        'set-itemproperty|new-itemproperty|remove-itemproperty|rename-itemproperty|clear-itemproperty|sp|new-item|ni|set-item|si',
      ),
      ANY,
      HIVE,
    ),
    reason: 'registry write',
  },
  // Persistence.
  {
    re: rx(
      w(
        'schtasks(?:\\.exe)?|register-scheduledtask|new-scheduledtask\\w*|set-scheduledtask|register-scheduledjob',
      ),
    ),
    reason: 'scheduled task (persistence)',
  },
  {
    re: rx(
      w('new-service|set-service'),
      '|',
      w('sc(?:\\.exe)?'),
      String.raw`\s+(create|config|delete)\b`,
    ),
    reason: 'service changes (persistence)',
  },
  {
    re: /start menu\\programs\\startup|shell:startup|currentversion\\run(once)?\b/,
    reason: 'startup persistence',
  },
  {
    re: rx(
      w('register-wmievent|set-wmiinstance|set-ciminstance|new-ciminstance'),
      '|__eventfilter|commandlineeventconsumer',
    ),
    reason: 'WMI persistence',
  },
  // Security software and policy.
  {
    re: rx(w('set-mppreference|add-mppreference|remove-mppreference')),
    reason: 'Windows Defender settings',
  },
  {
    re: rx(
      w('netsh'),
      ANY,
      String.raw`\b(advfirewall|firewall)\b|`,
      w('set-netfirewall\\w*|new-netfirewallrule|remove-netfirewallrule|disable-netfirewallrule'),
    ),
    reason: 'firewall changes',
  },
  { re: rx(w('set-executionpolicy')), reason: 'execution policy change' },
  { re: /consentpromptbehavior|enablelua|smartscreen/, reason: 'UAC / SmartScreen settings' },
  // Elevation.
  {
    re: rx(
      String.raw`-verb\s+['"]?runas\b|`,
      w('runas(?:\\.exe)?'),
      '|',
      w('start-process|saps|start'),
      ANY,
      String.raw`-verb\b`,
    ),
    reason: 'elevation (admin rights)',
  },
  // Network transfer and dynamic execution.
  {
    re: rx(
      w(
        'invoke-webrequest|iwr|invoke-restmethod|irm|curl(?:\\.exe)?|wget(?:\\.exe)?|start-bitstransfer|bitsadmin(?:\\.exe)?',
      ),
    ),
    reason: 'network download / upload',
  },
  {
    re: /net\.webclient|downloadstring|downloadfile|downloaddata|uploadstring|uploadfile|system\.net\.http|net\.sockets/,
    reason: 'network download / upload',
  },
  { re: rx(w('invoke-expression|iex')), reason: 'dynamic code execution (Invoke-Expression)' },
  { re: /frombase64string/, reason: 'decoding hidden (base64) content' },
  {
    re: rx(
      w('powershell(?:\\.exe)?|pwsh(?:\\.exe)?'),
      ANY,
      String.raw`\s-(e|ec|en|enc|enco|encod|encode|encoded|encodedc\w*)\b`,
    ),
    reason: 'nested encoded PowerShell',
  },
  {
    re: rx(
      w('mshta(?:\\.exe)?|regsvr32(?:\\.exe)?'),
      String.raw`|\brundll32\b`,
      ANY,
      String.raw`javascript|\bcertutil\b`,
      ANY,
      String.raw`-(urlcache|decode)`,
    ),
    reason: 'living-off-the-land execution',
  },
  // Credentials and secret files.
  {
    re: rx(
      w(
        'cmdkey(?:\\.exe)?|vaultcmd(?:\\.exe)?|get-credential|get-storedcredential|convertfrom-securestring|mimikatz',
      ),
    ),
    reason: 'credential access',
  },
  {
    re: /\\\.ssh\\|id_rsa|id_ed25519|login data|\\cookies\b|secrets\.bin|jarvis\.db|\.kdbx\b/,
    reason: 'credential / secret files',
  },
  // Accounts.
  {
    re: rx(w('new-localuser|add-localgroupmember'), String.raw`|\bnet\s+(user|localgroup)\b`),
    reason: 'user account changes',
  },
];

/** PowerShell's escape character (backtick) and cmd's caret are inserted mid-word to dodge filters: R`e`move-Item. */
function normalize(script: string): string {
  return script
    .replace(/`(?=[a-z0-9-])/gi, '')
    .replace(/\^(?=[a-z])/gi, '')
    .replace(/'\s*\+\s*'/g, '') // 'Remove-' + 'Item'
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function decodeEncodedCommands(script: string): string[] {
  const out: string[] = [];
  for (const m of script.matchAll(/\s-e[a-z]*\s+['"]?([A-Za-z0-9+/=]{8,})/gi)) {
    out.push(Buffer.from(m[1] as string, 'base64').toString('utf16le')); // group 1 always matches
  }
  return out;
}

export function checkShellScript(script: string, depth = 0): ShellVerdict {
  const text = normalize(script);
  const reasons = new Set<string>();
  for (const rule of RULES) if (rule.re.test(text)) reasons.add(rule.reason);
  if (depth < 2) {
    for (const inner of decodeEncodedCommands(script)) {
      for (const r of checkShellScript(inner, depth + 1).reasons) reasons.add(r);
    }
  }
  return { blocked: reasons.size > 0, reasons: [...reasons] };
}
