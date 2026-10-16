import { statfsSync } from 'node:fs';
import os from 'node:os';

interface CpuTimes {
  idle: number;
  total: number;
}

function cpuTimes(cpus: os.CpuInfo[]): CpuTimes {
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Busy share between two samples of os.cpus() times, 0–100. */
export function cpuPercent(prev: CpuTimes, next: CpuTimes): number {
  const total = next.total - prev.total;
  if (total <= 0) return 0;
  return Math.round(Math.max(0, Math.min(1, 1 - (next.idle - prev.idle) / total)) * 1000) / 10;
}

/**
 * Live PC monitor (stage panel 'system'; idea from JashanMaan28/Zorin and eadmin2/jarvis_ai): Node's
 * own counters, no PowerShell, so it can poll every two seconds. CPU is measured since the last call.
 */
export function createSystemSampler(systemDrive = process.env['SystemDrive'] ?? 'C:') {
  let prev = cpuTimes(os.cpus());
  return () => {
    const cpus = os.cpus();
    const next = cpuTimes(cpus);
    const cpu = cpuPercent(prev, next);
    prev = next;
    let disk: { used: number; total: number } | null;
    try {
      const s = statfsSync(`${systemDrive}\\`);
      disk = { used: (s.blocks - s.bfree) * s.bsize, total: s.blocks * s.bsize };
    } catch {
      disk = null; // Not fatal: the panel shows "—" for the disk.
    }
    return {
      cpuPercent: cpu,
      cpuModel: cpus[0]?.model.trim() ?? 'CPU',
      cores: cpus.length,
      memUsedBytes: os.totalmem() - os.freemem(),
      memTotalBytes: os.totalmem(),
      diskUsedBytes: disk?.used ?? null,
      diskTotalBytes: disk?.total ?? null,
      uptimeSec: Math.round(os.uptime()),
    };
  };
}
