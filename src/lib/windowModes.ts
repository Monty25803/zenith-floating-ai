import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";

export const BUBBLE_SIZE = { width: 64, height: 64 };
export const PANEL_SIZE = { width: 420, height: 560 };

export async function placeBubble() {
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(BUBBLE_SIZE.width, BUBBLE_SIZE.height));
  const monitor = await currentMonitor();
  if (!monitor) {
    await win.setPosition(new LogicalPosition(40, 40));
    return;
  }
  const scale = monitor.scaleFactor;
  const screenW = monitor.size.width / scale;
  const screenH = monitor.size.height / scale;
  const posX = Math.max(16, screenW - BUBBLE_SIZE.width - 28);
  const posY = Math.max(16, screenH - BUBBLE_SIZE.height - 48);
  await win.setPosition(new LogicalPosition(posX, posY));
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
