/**
 * safeIpc.ts — shared types for the idempotent IPC registration wrappers.
 *
 * `SafeHandle` and `SafeOn` are the signatures of the narrow, idempotent
 * `safeHandle` / `safeOn` helpers defined in electron/ipcHandlers.ts. Domain
 * handler modules (electron/ipc/*Handlers.ts) receive these wrappers as
 * parameters so every channel they register stays type-checked against the
 * generated IpcInvokeChannel / IpcSendChannel unions
 * (electron/ipc/ipcChannels.ts) — a typo'd channel fails typecheck instead of
 * registering a handler the renderer can never reach.
 */
import type { IpcInvokeChannel, IpcSendChannel } from './ipcChannels';

/** Narrow, idempotent ipcMain.handle wrapper (remove-then-register). */
export type SafeHandle = (
  channel: IpcInvokeChannel,
  listener: (event: any, ...args: any[]) => Promise<any> | any,
) => void;

/** Narrow, idempotent ipcMain.on wrapper (remove-all-listeners-then-listen). */
export type SafeOn = (
  channel: IpcSendChannel,
  listener: (event: any, ...args: any[]) => void,
) => void;
