import {
  Activity,
  Cpu,
  Download,
  FileDown,
  FileUp,
  Link2,
  Lightbulb,
  PlugZap,
  Power,
  PowerOff,
  Save,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";

type SerialPortLike = {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
};

type SerialNavigator = Navigator & {
  serial?: {
    requestPort(): Promise<SerialPortLike>;
  };
};

type LatestState = {
  k1raw: number | null;
  k2raw: number | null;
  k1pos: number | null;
  k2pos: number | null;
  k1pressed: boolean;
  k2pressed: boolean;
  armed: boolean;
  k1ready: boolean;
  k2ready: boolean;
};

type Settings = {
  filter_alpha: string;
  filter_samples: string;
  trigger_deadband: string;
  trigger_confirm: string;
  led_enabled: string;
  led_brightness: string;
  led_disarmed: string;
  k1_min: string;
  k1_max: string;
  k1_act: string;
  k1_rt: string;
  k1_key: string;
  k1_led_r: string;
  k1_led_g: string;
  k1_led_b: string;
  k2_min: string;
  k2_max: string;
  k2_act: string;
  k2_rt: string;
  k2_key: string;
  k2_led_r: string;
  k2_led_g: string;
  k2_led_b: string;
};

const DEFAULT_SETTINGS: Settings = {
  filter_alpha: "0.20",
  filter_samples: "10",
  trigger_deadband: "0.025",
  trigger_confirm: "4",
  led_enabled: "1",
  led_brightness: "0.28",
  led_disarmed: "1",
  k1_min: "17000",
  k1_max: "31000",
  k1_act: "0.45",
  k1_rt: "0.10",
  k1_key: "Z",
  k1_led_r: "0",
  k1_led_g: "1",
  k1_led_b: "0",
  k2_min: "17000",
  k2_max: "31000",
  k2_act: "0.45",
  k2_rt: "0.10",
  k2_key: "X",
  k2_led_r: "0",
  k2_led_g: "0",
  k2_led_b: "1",
};

const KEY_OPTIONS = [
  "NONE",
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
  "SPACE",
  "ENTER",
  "ESCAPE",
  "TAB",
  "LEFT",
  "RIGHT",
  "UP",
  "DOWN",
];

const SETTING_IDS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;
const STORAGE_KEY = "wooter-settings:v1";
const CONFIG_VERSION = 1;

const initialLatest: LatestState = {
  k1raw: null,
  k2raw: null,
  k1pos: null,
  k2pos: null,
  k1pressed: false,
  k2pressed: false,
  armed: false,
  k1ready: false,
  k2ready: false,
};

function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [latest, setLatest] = useState<LatestState>(initialLatest);
  const [connected, setConnected] = useState(false);
  const [lastLine, setLastLine] = useState("waiting");
  const [logLines, setLogLines] = useState<string[]>([
    "Open the Vite Local URL in Chrome or Edge, then connect to the Pico serial port.",
  ]);

  const portRef = useRef<SerialPortLike | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const keepReadingRef = useRef(false);
  const bufferRef = useRef("");
  const settingsRef = useRef(settings);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const encoder = useMemo(() => new TextEncoder(), []);

  const log = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLogLines((lines) => [...lines.slice(-179), `[${stamp}] ${message}`]);
  }, []);

  const handleLine = useCallback(
    (line: string) => {
      if (!line) return;
      setLastLine(line.length > 38 ? `${line.slice(0, 38)}...` : line);

      if (line.startsWith("CONFIG ")) {
        try {
          const imported = extractSettings(JSON.parse(line.slice(7)));
          const next = { ...settingsRef.current, ...imported };
          settingsRef.current = next;
          setSettings(next);
          log(`Loaded ${Object.keys(imported).length} settings from keypad.`);
        } catch (error) {
          log(`Keypad config failed: ${errorMessage(error)}`);
        }
        return;
      }

      if (!line.startsWith("DATA ")) {
        log(`< ${line}`);
        return;
      }

      const p = line.split(/\s+/);
      if (p.length < 10) return;

      const parsed = {
        k1raw: Number(p[1]),
        k2raw: Number(p[2]),
        k1pos: Number(p[3]),
        k2pos: Number(p[4]),
        k1pressed: p[5] === "1",
        k2pressed: p[6] === "1",
        armed: p[7] === "1",
        k1ready: p[8] === "1",
        k2ready: p[9] === "1",
      };

      if (
        !Number.isFinite(parsed.k1raw) ||
        !Number.isFinite(parsed.k2raw) ||
        !Number.isFinite(parsed.k1pos) ||
        !Number.isFinite(parsed.k2pos)
      ) {
        return;
      }

      setLatest(parsed);
    },
    [log],
  );

  const flushLines = useCallback(() => {
    const lines = bufferRef.current.split(/\r?\n/);
    bufferRef.current = lines.pop() ?? "";
    for (const line of lines) {
      handleLine(line.trim());
    }
  }, [handleLine]);

  const readLoop = useCallback(async () => {
    const port = portRef.current;
    if (!port?.readable) return;

    const decoder = new TextDecoder();
    keepReadingRef.current = true;
    readerRef.current = port.readable.getReader();

    try {
      while (keepReadingRef.current) {
        const { value, done } = await readerRef.current.read();
        if (done) break;
        if (value) {
          bufferRef.current += decoder.decode(value, { stream: true });
          flushLines();
        }
      }
    } catch (error) {
      if (keepReadingRef.current) {
        log(`Read failed: ${errorMessage(error)}`);
      }
    } finally {
      try {
        readerRef.current?.releaseLock();
      } catch {
        // Ignore release errors while disconnecting.
      }
      readerRef.current = null;
      if (keepReadingRef.current) {
        setConnected(false);
      }
    }
  }, [flushLines, log]);

  const sendCommand = useCallback(
    async (command: string) => {
      const writer = writerRef.current;
      if (!writer) {
        log(`not connected: ${command}`);
        return;
      }

      try {
        await writer.write(encoder.encode(`${command}\n`));
        log(`> ${command}`);
      } catch (error) {
        log(`Write failed: ${errorMessage(error)}`);
      }
    },
    [encoder, log],
  );

  const sendSetting = useCallback(
    async (id: keyof Settings, nextValue?: string) => {
      const value = nextValue ?? settingsRef.current[id];
      if (isNumericSetting(id) && !Number.isFinite(Number(value))) return;
      await sendCommand(`SET ${id} ${value}`);
    },
    [sendCommand],
  );

  const applyAll = useCallback(async () => {
    for (const id of SETTING_IDS) {
      await sendSetting(id);
    }
  }, [sendSetting]);

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;

    try {
      await readerRef.current?.cancel();
    } catch {
      // Reader may already be closed.
    }

    try {
      writerRef.current?.releaseLock();
    } catch {
      // Writer may already be released.
    }
    writerRef.current = null;

    try {
      await portRef.current?.close();
    } catch {
      // Port may already be closed.
    }
    portRef.current = null;
    setConnected(false);
  }, []);

  const connect = useCallback(async () => {
    if (location.protocol === "file:") {
      log("Run npm run dev and open the Vite Local URL. Do not use file://.");
      return;
    }

    if (!window.isSecureContext) {
      log("This URL is not a secure context. Use http://localhost:5173/, not the Network IP URL.");
      return;
    }

    const serial = (navigator as SerialNavigator).serial;
    if (!serial) {
      log("Web Serial is unavailable. Use Chrome or Edge on localhost.");
      return;
    }

    try {
      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });
      if (!port.writable) throw new Error("Serial port is not writable.");

      portRef.current = port;
      writerRef.current = port.writable.getWriter();
      setConnected(true);
      log("Connected.");
      void readLoop();
      await sendCommand("ARM 0");
      await sendCommand("CONFIG");
    } catch (error) {
      log(`Connect failed: ${errorMessage(error)}`);
      await disconnect();
    }
  }, [disconnect, log, readLoop, sendCommand]);

  const setSetting = useCallback(
    (id: keyof Settings, value: string, send = true) => {
      settingsRef.current = { ...settingsRef.current, [id]: value };
      setSettings(settingsRef.current);
      if (send) void sendSetting(id, value);
    },
    [sendSetting],
  );

  const captureRaw = useCallback(
    (id: "k1_min" | "k1_max" | "k2_min" | "k2_max") => {
      const keyNumber = id.startsWith("k1_") ? 1 : 2;
      const raw = latest[`k${keyNumber}raw` as "k1raw" | "k2raw"];
      if (!Number.isFinite(raw)) {
        log("No live raw value yet.");
        return;
      }
      setSetting(id, String(Math.round(raw)));
    },
    [latest, log, setSetting],
  );

  const saveLocal = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsRef.current));
    log("Saved settings in this browser.");
  }, [log]);

  const loadLocal = useCallback(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      log("No browser settings saved yet.");
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      const next = { ...settingsRef.current };
      for (const id of SETTING_IDS) {
        if (parsed[id] != null) next[id] = String(parsed[id]);
      }
      settingsRef.current = next;
      setSettings(next);
      log("Loaded browser settings.");
      void applyAll();
    } catch (error) {
      log(`Load failed: ${errorMessage(error)}`);
    }
  }, [applyAll, log]);

  const saveToKeypad = useCallback(async () => {
    await applyAll();
    await sendCommand("SAVE");
  }, [applyAll, sendCommand]);

  const loadFromKeypad = useCallback(async () => {
    await sendCommand("CONFIG");
  }, [sendCommand]);

  const exportConfig = useCallback(() => {
    const payload = {
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      settings: settingsRef.current,
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    anchor.href = url;
    anchor.download = `wooter-config-${stamp}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    log("Exported config JSON.");
  }, [log]);

  const importConfig = useCallback(
    async (file: File | null) => {
      if (!file) return;

      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        const imported = extractSettings(parsed);
        const next = { ...settingsRef.current, ...imported };
        settingsRef.current = next;
        setSettings(next);
        log(`Imported ${Object.keys(imported).length} config values from ${file.name}.`);
        await applyAll();
      } catch (error) {
        log(`Import failed: ${errorMessage(error)}`);
      } finally {
        if (importInputRef.current) importInputRef.current.value = "";
      }
    },
    [applyAll, log],
  );

  const bothReady = latest.k1ready && latest.k2ready;
  const fileOrigin = location.protocol === "file:";
  const insecureOrigin = !fileOrigin && !window.isSecureContext;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        {(fileOrigin || insecureOrigin) && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            <strong className="font-semibold">Open this from localhost.</strong>{" "}
            Web Serial will not work from this address. Run{" "}
            <code className="rounded bg-background/70 px-1 py-0.5">npm run dev</code> and use{" "}
            <code className="rounded bg-background/70 px-1 py-0.5">http://localhost:5173/</code>.
          </div>
        )}

        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Cpu className="size-7 text-primary" />
              <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                Wooter Hall Keypad
              </h1>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Configure two SS49E Hall keys over USB serial. Keyboard output stays disabled until
              the device is armed and each key has valid calibration.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={connect} disabled={connected}>
              <Link2 />
              Connect
            </Button>
            <Button variant="outline" onClick={disconnect} disabled={!connected}>
              <PlugZap />
              Disconnect
            </Button>
            <Button variant="secondary" onClick={() => void sendCommand("ARM 1")} disabled={!connected}>
              <Power />
              Arm
            </Button>
            <Button
              variant="destructive"
              onClick={() => void sendCommand("ARM 0")}
              disabled={!connected}
            >
              <PowerOff />
              Disarm
            </Button>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="size-5" />
                  Live Values
                </CardTitle>
                <CardDescription>
                  Raw values are filtered in firmware before position and trigger calculations.
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge ok={connected} okText="connected" badText="not connected" />
                <StatusBadge ok={latest.armed} okText="armed" badText="disarmed" warn />
                <StatusBadge ok={bothReady} okText="calibrated" badText="not ready" warn />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <LiveKey
                  title="Key 1"
                  raw={latest.k1raw}
                  position={latest.k1pos}
                  pressed={latest.k1pressed}
                  ready={latest.k1ready}
                />
                <LiveKey
                  title="Key 2"
                  raw={latest.k2raw}
                  position={latest.k2pos}
                  pressed={latest.k2pressed}
                  ready={latest.k2ready}
                />
              </div>
              <Separator />
              <p className="text-sm leading-6 text-muted-foreground">
                Calibration expects max to be the no-magnet/rest value and min to be the
                magnet-close value. Use the live raw value buttons while each key is in that state.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => void applyAll()} disabled={!connected}>
                  <Upload />
                  Apply All Settings
                </Button>
                <Button variant="outline" onClick={() => void saveToKeypad()} disabled={!connected}>
                  <Save />
                  Save to Keypad
                </Button>
                <Button variant="outline" onClick={() => void loadFromKeypad()} disabled={!connected}>
                  <Download />
                  Load from Keypad
                </Button>
                <Button variant="outline" onClick={saveLocal}>
                  <Save />
                  Save Settings
                </Button>
                <Button variant="outline" onClick={loadLocal}>
                  <Download />
                  Load Settings
                </Button>
                <Button variant="outline" onClick={exportConfig}>
                  <FileDown />
                  Export Config
                </Button>
                <Button variant="outline" onClick={() => importInputRef.current?.click()}>
                  <FileUp />
                  Import Config
                </Button>
                <input
                  ref={importInputRef}
                  className="hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => void importConfig(event.currentTarget.files?.[0] ?? null)}
                />
                <Button variant="ghost" onClick={() => setLogLines([])}>
                  <Trash2 />
                  Clear Log
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Serial Log</CardTitle>
                <CardDescription>Last line: {lastLine}</CardDescription>
              </div>
              <Badge variant="outline">{connected ? "open" : "idle"}</Badge>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-72 rounded-md border bg-muted/30 p-3">
                <pre className="whitespace-pre-wrap font-mono text-xs leading-5 text-muted-foreground">
                  {logLines.join("\n")}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontal className="size-5" />
                Signal Filtering
              </CardTitle>
              <CardDescription>
                Lower response and higher sample/confirm values reduce jitter. Higher response
                feels faster.
              </CardDescription>
            </div>
            <Badge variant="outline">sent live when connected</Badge>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SliderSetting
              id="filter_alpha"
              label="Filter response"
              min={0.05}
              max={0.95}
              step={0.01}
              value={settings.filter_alpha}
              onChange={setSetting}
            />
            <SliderSetting
              id="filter_samples"
              label="ADC samples"
              min={1}
              max={32}
              step={1}
              value={settings.filter_samples}
              onChange={setSetting}
            />
            <SliderSetting
              id="trigger_deadband"
              label="Trigger deadband"
              min={0}
              max={0.2}
              step={0.005}
              value={settings.trigger_deadband}
              onChange={setSetting}
            />
            <SliderSetting
              id="trigger_confirm"
              label="Confirm frames"
              min={1}
              max={10}
              step={1}
              value={settings.trigger_confirm}
              onChange={setSetting}
            />
          </CardContent>
        </Card>

        <section className="grid gap-4 lg:grid-cols-2">
          <KeySettings
            keyNumber={1}
            settings={settings}
            setSetting={setSetting}
            captureRaw={captureRaw}
            applyKey={async () => {
              for (const id of SETTING_IDS.filter((id) => id.startsWith("k1_"))) {
                await sendSetting(id);
              }
            }}
          />
          <KeySettings
            keyNumber={2}
            settings={settings}
            setSetting={setSetting}
            captureRaw={captureRaw}
            applyKey={async () => {
              for (const id of SETTING_IDS.filter((id) => id.startsWith("k2_"))) {
                await sendSetting(id);
              }
            }}
          />
        </section>

        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="size-5" />
                RGB LED
              </CardTitle>
              <CardDescription>
                Disarmed is red. When armed, each key blends its configured color by press depth.
              </CardDescription>
            </div>
            <Badge variant="outline">requires the RGB jumper bridged</Badge>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-3">
              <SliderSetting
                id="led_enabled"
                label="LED enabled"
                min={0}
                max={1}
                step={1}
                value={settings.led_enabled}
                onChange={setSetting}
              />
              <SliderSetting
                id="led_brightness"
                label="Max brightness"
                min={0}
                max={1}
                step={0.01}
                value={settings.led_brightness}
                onChange={setSetting}
              />
              <SliderSetting
                id="led_disarmed"
                label="Disarmed red"
                min={0}
                max={1}
                step={0.01}
                value={settings.led_disarmed}
                onChange={setSetting}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <LedColorSettings
                title="Key 1 color"
                redId="k1_led_r"
                greenId="k1_led_g"
                blueId="k1_led_b"
                settings={settings}
                setSetting={setSetting}
              />
              <LedColorSettings
                title="Key 2 color"
                redId="k2_led_r"
                greenId="k2_led_g"
                blueId="k2_led_b"
                settings={settings}
                setSetting={setSetting}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function LiveKey({
  title,
  raw,
  position,
  pressed,
  ready,
}: {
  title: string;
  raw: number | null;
  position: number | null;
  pressed: boolean;
  ready: boolean;
}) {
  const pct = clamp01(position ?? 0) * 100;

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="flex gap-2">
          <StatusBadge ok={ready} okText="ready" badText="not ready" warn />
          <Badge variant={pressed ? "default" : "outline"}>{pressed ? "pressed" : "released"}</Badge>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Metric label="Raw" value={raw == null ? "--" : raw.toFixed(0)} />
        <Metric label="Position" value={position == null ? "--" : position.toFixed(3)} />
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full border bg-background">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background/70 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl">{value}</div>
    </div>
  );
}

function KeySettings({
  keyNumber,
  settings,
  setSetting,
  captureRaw,
  applyKey,
}: {
  keyNumber: 1 | 2;
  settings: Settings;
  setSetting: (id: keyof Settings, value: string, send?: boolean) => void;
  captureRaw: (id: "k1_min" | "k1_max" | "k2_min" | "k2_max") => void;
  applyKey: () => Promise<void>;
}) {
  const prefix = `k${keyNumber}` as const;
  const minId = `${prefix}_min` as keyof Settings;
  const maxId = `${prefix}_max` as keyof Settings;
  const actId = `${prefix}_act` as keyof Settings;
  const rtId = `${prefix}_rt` as keyof Settings;
  const keyId = `${prefix}_key` as keyof Settings;
  const min = Number(settings[minId]);
  const max = Number(settings[maxId]);
  const validRange = Number.isFinite(min) && Number.isFinite(max) && max > min;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Key {keyNumber}</CardTitle>
          <CardDescription>
            {validRange ? `Range ${Math.round(max - min)}` : "Invalid calibration range"}
          </CardDescription>
        </div>
        <StatusBadge ok={validRange} okText="range ok" badText="bad range" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <NumberWithCapture
            id={minId as "k1_min" | "k2_min"}
            label="Min pressed raw"
            value={settings[minId]}
            setSetting={setSetting}
            captureRaw={captureRaw}
          />
          <NumberWithCapture
            id={maxId as "k1_max" | "k2_max"}
            label="Max rest raw"
            value={settings[maxId]}
            setSetting={setSetting}
            captureRaw={captureRaw}
          />
          <SliderSetting
            id={actId}
            label="Actuation point"
            min={0.05}
            max={0.95}
            step={0.01}
            value={settings[actId]}
            onChange={setSetting}
          />
          <SliderSetting
            id={rtId}
            label="Rapid trigger distance"
            min={0.01}
            max={0.5}
            step={0.01}
            value={settings[rtId]}
            onChange={setSetting}
          />
        </div>

        <div className="grid gap-2">
          <Label>Keyboard output</Label>
          <Select value={settings[keyId]} onValueChange={(value) => setSetting(keyId, value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KEY_OPTIONS.map((key) => (
                <SelectItem key={key} value={key}>
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setSetting(keyId, keyNumber === 1 ? "Z" : "X")}>
            Preset {keyNumber === 1 ? "Z" : "X"}
          </Button>
          <Button variant="secondary" onClick={() => void applyKey()}>
            Apply Key {keyNumber}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function NumberWithCapture({
  id,
  label,
  value,
  setSetting,
  captureRaw,
}: {
  id: "k1_min" | "k1_max" | "k2_min" | "k2_max";
  label: string;
  value: string;
  setSetting: (id: keyof Settings, value: string, send?: boolean) => void;
  captureRaw: (id: "k1_min" | "k1_max" | "k2_min" | "k2_max") => void;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <Input id={id} type="number" value={value} onChange={(event) => setSetting(id, event.target.value)} />
        <Button variant="outline" type="button" onClick={() => captureRaw(id)}>
          Use Raw
        </Button>
      </div>
    </div>
  );
}

function LedColorSettings({
  title,
  redId,
  greenId,
  blueId,
  settings,
  setSetting,
}: {
  title: string;
  redId: keyof Settings;
  greenId: keyof Settings;
  blueId: keyof Settings;
  settings: Settings;
  setSetting: (id: keyof Settings, value: string, send?: boolean) => void;
}) {
  const red = Math.round(Number(settings[redId]) * 255);
  const green = Math.round(Number(settings[greenId]) * 255);
  const blue = Math.round(Number(settings[blueId]) * 255);

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <div
          className="size-8 rounded-md border"
          style={{ backgroundColor: `rgb(${red}, ${green}, ${blue})` }}
        />
      </div>
      <div className="grid gap-3">
        <SliderSetting
          id={redId}
          label="Red"
          min={0}
          max={1}
          step={0.01}
          value={settings[redId]}
          onChange={setSetting}
        />
        <SliderSetting
          id={greenId}
          label="Green"
          min={0}
          max={1}
          step={0.01}
          value={settings[greenId]}
          onChange={setSetting}
        />
        <SliderSetting
          id={blueId}
          label="Blue"
          min={0}
          max={1}
          step={0.01}
          value={settings[blueId]}
          onChange={setSetting}
        />
      </div>
    </div>
  );
}

function SliderSetting({
  id,
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  id: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  value: string;
  onChange: (id: keyof Settings, value: string, send?: boolean) => void;
}) {
  const numericValue = Number(value);
  const safeValue = Number.isFinite(numericValue) ? numericValue : min;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3">
        <Slider
          value={[safeValue]}
          min={min}
          max={max}
          step={step}
          onValueChange={([next]) => onChange(id, formatNumber(next, step))}
        />
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(id, event.target.value)}
        />
      </div>
    </div>
  );
}

function StatusBadge({
  ok,
  okText,
  badText,
  warn = false,
}: {
  ok: boolean;
  okText: string;
  badText: string;
  warn?: boolean;
}) {
  return (
    <Badge variant={ok ? "default" : warn ? "secondary" : "destructive"}>
      {ok ? okText : badText}
    </Badge>
  );
}

function isNumericSetting(id: keyof Settings) {
  return id !== "k1_key" && id !== "k2_key";
}

function extractSettings(value: unknown): Partial<Settings> {
  const source =
    isRecord(value) && isRecord(value.settings) ? value.settings : isRecord(value) ? value : null;
  if (!source) throw new Error("Config must be a JSON object.");

  const imported: Partial<Settings> = {};
  for (const id of SETTING_IDS) {
    const raw = source[id];
    if (raw == null) continue;
    const next = String(raw).trim();
    if (!next) continue;
    if (isNumericSetting(id) && !Number.isFinite(Number(next))) {
      throw new Error(`Invalid numeric value for ${id}.`);
    }
    if ((id === "k1_key" || id === "k2_key") && !KEY_OPTIONS.includes(next.toUpperCase())) {
      throw new Error(`Invalid key output for ${id}.`);
    }
    imported[id] = id === "k1_key" || id === "k2_key" ? next.toUpperCase() : next;
  }

  if (Object.keys(imported).length === 0) {
    throw new Error("Config did not contain any known settings.");
  }
  return imported;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatNumber(value: number, step: number) {
  if (step >= 1) return String(Math.round(value));
  const decimals = Math.max(0, String(step).split(".")[1]?.length ?? 0);
  return value.toFixed(decimals);
}

export default App;
