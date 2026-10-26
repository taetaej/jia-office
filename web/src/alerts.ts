// alerts.ts — make sure the user never misses an approval, even when the office
// tab isn't on screen: a desktop notification per new approval (click → back to
// the office, camera on the waiting cat), a flashing tab title while anything is
// waiting, and a short two-tone chime. All three are user toggles.

import type { Approval } from './socket.js';

export interface AlertSettings {
  desktop: boolean;
  sound: boolean;
  /** include Claude Code "probably waiting for permission" guesses */
  inferred: boolean;
}

const SETTINGS_KEY = 'ko.alerts';
const key = (a: Approval): string => `${a.id}:${a.since}`;

export function loadAlertSettings(): AlertSettings {
  const defaults: AlertSettings = { desktop: false, sound: true, inferred: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<AlertSettings>) };
  } catch { /* ignore malformed storage */ }
  return defaults;
}

export function saveAlertSettings(s: AlertSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* noop */ }
}

export class ApprovalAlerts {
  private seen = new Set<string>();
  private count = 0;
  private flashOn = false;
  private readonly baseTitle = document.title;
  private audio: AudioContext | null = null;

  constructor(private readonly settings: AlertSettings, private readonly onOpen: (a: Approval) => void) {
    setInterval(() => this.flash(), 1000);
    // browsers only allow sound after a user gesture: unlock audio on the first click
    window.addEventListener('pointerdown', () => { void this.ctx()?.resume(); }, { once: true });
  }

  /** Ask for desktop-notification permission (call from a click). Resolves to whether it's allowed. */
  async enableDesktop(): Promise<boolean> {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  }

  /** The current approval queue from the watcher. New entries ring and notify. */
  update(items: Approval[]): void {
    const fresh = items.filter((a) => !this.seen.has(key(a)));
    this.seen = new Set(items.map(key));
    this.count = items.length;
    this.flash();
    if (!fresh.length) return;
    if (this.settings.sound) this.chime();
    if (this.settings.desktop && 'Notification' in window && Notification.permission === 'granted') {
      for (const a of fresh) this.notify(a);
    }
  }

  private notify(a: Approval): void {
    const who = a.kind === 'main' ? `에이전트 · ${a.who}` : a.kind === 'workflow' ? `서브냥 · ${a.who}` : a.who;
    const n = new Notification(a.inferred ? '🕵️ 허용을 기다리는 것 같아요' : '🔔 결재 대기', {
      body: `${who}\n${a.question}`, // textual only — the OS renders it as plain text
      tag: a.id,
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      this.onOpen(a);
      n.close();
    };
  }

  /** Tab title: "(2) 🔔 결재 대기" blinking while anything waits. */
  private flash(): void {
    if (!this.count) {
      if (document.title !== this.baseTitle) document.title = this.baseTitle;
      return;
    }
    this.flashOn = !this.flashOn;
    document.title = this.flashOn ? `(${this.count}) 🔔 결재 대기` : this.baseTitle;
  }

  private ctx(): AudioContext | null {
    if (!this.audio) {
      try { this.audio = new AudioContext(); } catch { return null; }
    }
    return this.audio;
  }

  /** A soft two-tone "ding-dong". */
  private chime(): void {
    const ctx = this.ctx();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    [880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = t0 + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }
}
