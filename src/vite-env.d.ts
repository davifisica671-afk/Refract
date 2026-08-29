/// <reference types="vite/client" />

import type { ElectronAPI } from "./types/electron";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
