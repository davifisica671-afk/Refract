// src/lib/micPermissionPolicy.mjs
//
// Shared mic-settings-panel policy: the platform decision lives here so main
// (ipcHandlers permissions:open-mic-settings) and renderer cannot disagree
// about which platforms have a reachable panel. No importer is modified.

export function micSettingsUri(platform) {
  if (platform === 'darwin') return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone';
  if (platform === 'win32') return 'ms-settings:privacy-microphone';
  return null;
}
