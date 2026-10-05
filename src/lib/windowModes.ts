import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

export const BUBBLE_SIZE = { width: 64, height: 64 };
export const PANEL_SIZE = { width: 760, height: 520 };

const BUBBLE_POS_KEY = "zenith.bubblePos";

export type BubblePos = { x: number; y: number };

export function loadBubblePos(): BubblePos | null {
  try {
    const raw = localStorage.getItem(BUBBLE_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BubblePos;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBubblePos(pos: BubblePos) {
  localStorage.setItem(BUBBLE_POS_KEY, JSON.stringify(pos));
}

export async function persistCurrentBubblePos() {
  const win = getCurrentWindow();
  const pos = await win.outerPosition();
  const scale = await win.scaleFactor();
  saveBubblePos({ x: pos.x / scale, y: pos.y / scale });
}

async function clampToMonitor(x: number, y: number, w: number, h: number) {
  const monitor = await currentMonitor();
  if (!monitor) return { x, y };
  const scale = monitor.scaleFactor;
  const screenW = monitor.size.width / scale;
  const screenH = monitor.size.height / scale;
  return {
    x: Math.min(Math.max(8, x), Math.max(8, screenW - w - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, screenH - h - 8)),
  };
}

export async function placeBubble() {
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(BUBBLE_SIZE.width, BUBBLE_SIZE.height));
  const monitor = await currentMonitor();
  const saved = loadBubblePos();

  if (!monitor) {
    const pos = saved ?? { x: 40, y: 40 };
    await win.setPosition(new LogicalPosition(pos.x, pos.y));
    return;
  }

  const scale = monitor.scaleFactor;
  const screenW = monitor.size.width / scale;
  const screenH = monitor.size.height / scale;
  const fallback = {
    x: Math.max(16, screenW - BUBBLE_SIZE.width - 28),
    y: Math.max(16, screenH - BUBBLE_SIZE.height - 48),
  };
  const desired = saved ?? fallback;
  const clamped = await clampToMonitor(
    desired.x,
    desired.y,
    BUBBLE_SIZE.width,
    BUBBLE_SIZE.height,
  );
  await win.setPosition(new LogicalPosition(clamped.x, clamped.y));
}

export async function placePanel() {
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(PANEL_SIZE.width, PANEL_SIZE.height));
  const monitor = await currentMonitor();
  if (!monitor) {
    await win.center();
    return;
  }
  const scale = monitor.scaleFactor;
  const screenW = monitor.size.width / scale;
  const screenH = monitor.size.height / scale;
  const posX = Math.max(16, (screenW - PANEL_SIZE.width) / 2);
  const posY = Math.max(16, (screenH - PANEL_SIZE.height) / 2);
  await win.setPosition(new LogicalPosition(posX, posY));
}
