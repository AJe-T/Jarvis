import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Copy } from 'lucide-react';
import type { StagePanel } from '@shared/stage';
import { Button } from '../../components/ui/button';
import { TextInput } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { StatGrid } from './stat-grid';

const POLL_MS = 2_000;
const HISTORY = 40;

type Sample = Awaited<ReturnType<typeof call<'system:stats'>>>;

interface BatteryLike {
  level: number;
  charging: boolean;
}

export const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function uptime(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

/** CPU history as an SVG polyline in a 100 × 24 box. */
export function sparkline(values: number[]): string {
  if (values.length < 2) return '';
  const step = 100 / (HISTORY - 1);
  const start = HISTORY - values.length;
  return values
    .map((v, i) => `${((start + i) * step).toFixed(1)},${(24 - (v / 100) * 24).toFixed(1)}`)
    .join(' ');
}

/** Live PC monitor (ideas from JashanMaan28/Zorin and eadmin2/jarvis_ai): read from main every 2 s. */
export function SystemMonitor(): React.JSX.Element {
  const [sample, setSample] = useState<Sample | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [battery, setBattery] = useState<BatteryLike | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void call('system:stats', {})
        .then((s) => {
          if (!alive) return;
          setSample(s);
          setCpuHistory((h) => [...h, s.cpuPercent].slice(-HISTORY));
        })
        .catch(() => undefined); // The next tick retries; the panel keeps the last sample.
    };
    tick();
    const t = setInterval(tick, POLL_MS);
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    void nav
      .getBattery?.()
      .then((b) => alive && setBattery(b))
      .catch(() => undefined);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!sample) return <p className="text-ink-500">Reading the system…</p>;
  const memPct = (sample.memUsedBytes / sample.memTotalBytes) * 100;
  const diskPct =
    sample.diskUsedBytes !== null && sample.diskTotalBytes
      ? (sample.diskUsedBytes / sample.diskTotalBytes) * 100
      : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="inset px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <span className="hud-label">cpu</span>
          <span className="font-code text-2xl text-ink-100 tabular">
            {Math.round(sample.cpuPercent)}%
          </span>
        </div>
        <svg
          viewBox="0 0 100 24"
          preserveAspectRatio="none"
          className="mt-1 h-10 w-full"
          aria-hidden
        >
          <polyline
            points={sparkline(cpuHistory)}
            fill="none"
            stroke="var(--accent-500)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        <p className="truncate text-xs text-ink-500" title={sample.cpuModel}>
          {sample.cores} threads · {sample.cpuModel}
        </p>
      </div>
      <StatGrid
        stats={[
          {
            label: 'memory',
            value: `${Math.round(memPct)}%`,
            hint: `${gb(sample.memUsedBytes)} of ${gb(sample.memTotalBytes)}`,
            percent: memPct,
          },
          {
            label: 'system drive',
            value: diskPct === undefined ? '—' : `${Math.round(diskPct)}%`,
            hint:
              sample.diskUsedBytes !== null && sample.diskTotalBytes !== null
                ? `${gb(sample.diskTotalBytes - sample.diskUsedBytes)} free`
                : undefined,
            percent: diskPct,
          },
          {
            label: 'battery',
            value: battery ? `${Math.round(battery.level * 100)}%` : 'Plugged in',
            hint: battery ? (battery.charging ? 'Charging' : 'On battery') : 'No battery reported',
            percent: battery ? battery.level * 100 : undefined,
            low: true,
          },
          { label: 'uptime', value: uptime(sample.uptimeSec), hint: 'since Windows started' },
        ]}
      />
    </div>
  );
}

/** QR modules as one SVG path ("M x y h1v1h-1z" per dark module), drawn here: nothing is sent anywhere. */
export function qrPath(text: string): { size: number; d: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  let d = '';
  for (let r = 0; r < modules.size; r++)
    for (let c = 0; c < modules.size; c++) if (modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return { size: modules.size, d };
}

/** A Wi-Fi QR carries the password ("WIFI:…;P:secret;;"): show dots on screen, the code keeps it. */
export const maskSecret = (text: string): string =>
  /^WIFI:/i.test(text) ? text.replace(/(WIFI:|;)P:(?:\\.|[^;])*/i, '$1P:••••••') : text;

/**
 * A QR code. Opened from the apps menu it starts empty and Sir types the text; from Jarvis it shows
 * Jarvis's text (never in an editable box, so a Wi-Fi password stays masked).
 */
export function QrPanel({ text: given }: Extract<StagePanel, { kind: 'qr' }>): React.JSX.Element {
  const toast = useUiStore((s) => s.toast);
  const editable = given === '';
  const [typed, setTyped] = useState('');
  const text = editable ? typed : given;
  const qr = useMemo(() => {
    if (!text) return undefined;
    try {
      return qrPath(text);
    } catch {
      return null; // Too long for a QR code: say so instead of crashing the panel.
    }
  }, [text]);
  const input = editable && (
    <TextInput
      aria-label="Text or link for the QR code"
      placeholder="Paste a link or type any text"
      autoFocus
      value={typed}
      onChange={(e) => setTyped(e.target.value)}
      className="w-full"
    />
  );
  if (!qr)
    return (
      <div className="flex flex-col gap-3">
        {input}
        {qr === null && <p className="text-alarm-500">That text is too long for a QR code.</p>}
      </div>
    );
  const pad = 4;
  return (
    <div className="flex flex-col items-center gap-4">
      {input}
      <svg
        viewBox={`${-pad} ${-pad} ${qr.size + pad * 2} ${qr.size + pad * 2}`}
        className="w-full max-w-72 rounded-lg bg-white"
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR code"
      >
        <path d={qr.d} fill="#000" />
      </svg>
      <p className="max-w-full text-center text-sm break-all text-ink-300">{maskSecret(text)}</p>
      <Button
        onClick={() =>
          void navigator.clipboard
            .writeText(text)
            .then(() => toast({ level: 'info', message: 'Copied.' }))
        }
      >
        <Copy size={14} aria-hidden />
        Copy text
      </Button>
    </div>
  );
}
