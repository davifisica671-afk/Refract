/**
 * =============================================================================
 * ThemeManager.ts — GERENCIADOR DE TEMAS VISUAIS
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Gerencia o tema visual da aplicação (claro/escuro/sistema).
 * Singleton que sincroniza o tema entre todas as janelas do Electron.
 * 
 * MODOS SUPORTADOS:
 * - 'system': Usa o tema do sistema operacional (automático)
 * - 'light': Sempre tema claro
 * - 'dark': Sempre tema escuro
 * 
 * COMO FUNCIONA:
 * 1. Carrega preferência do arquivo theme-config.json
 * 2. Sincroniza com nativeTheme do Electron
 * 3. Escuta mudanças no tema do sistema
 * 4. Notifica todas as janelas via IPC quando tema muda
 * 5. Salva preferência em disco
 * 
 * PERSISTÊNCIA:
 * - Arquivo: {userData}/theme-config.json
 * - Escrita atômica: escreve em .tmp e renomeia (evita corrupção)
 * =============================================================================
 */
import { nativeTheme, ipcMain, BrowserWindow, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeConfig {
    mode: ThemeMode;
}

export class ThemeManager {
    private static instance: ThemeManager;
    private mode: ThemeMode = 'system';
    private configPath: string;

    private constructor() {
        this.configPath = path.join(app.getPath('userData'), 'theme-config.json');
        this.loadConfig();
        this.setupListeners();
    }

    public static getInstance(): ThemeManager {
        if (!ThemeManager.instance) {
            ThemeManager.instance = new ThemeManager();
        }
        return ThemeManager.instance;
    }

    private loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const data = fs.readFileSync(this.configPath, 'utf8');
                const config = JSON.parse(data) as ThemeConfig;
                if (['system', 'light', 'dark'].includes(config.mode)) {
                    this.mode = config.mode;
                }
            }
        } catch (error) {
            console.error('Failed to load theme config:', error);
        }
    }

    private saveConfig() {
        try {
            const config: ThemeConfig = { mode: this.mode };
            const tmpPath = this.configPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
            fs.renameSync(tmpPath, this.configPath);
        } catch (error) {
            console.error('[ThemeManager] Failed to save config:', error);
        }
    }

    private setupListeners() {
        nativeTheme.on('updated', () => {
            if (this.mode === 'system') {
                this.broadcastThemeChange();
            }
        });
    }

    public getMode(): ThemeMode {
        return this.mode;
    }

    public setMode(mode: ThemeMode) {
        this.mode = mode;
        this.saveConfig();

        // Força a atualização do tema nativo se não for 'system', para que a UI interna do Electron corresponda
        if (mode === 'dark') {
            nativeTheme.themeSource = 'dark';
        } else if (mode === 'light') {
            nativeTheme.themeSource = 'light';
        } else {
            nativeTheme.themeSource = 'system';
        }

        this.broadcastThemeChange();
    }

    public getResolvedTheme(): ResolvedTheme {
        if (this.mode === 'system') {
            return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
        }
        return this.mode;
    }

    public broadcastThemeChange() {
        const payload = {
            mode: this.mode,
            resolved: this.getResolvedTheme()
        };

        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
                win.webContents.send('theme:changed', payload);
            }
        });
    }
}
