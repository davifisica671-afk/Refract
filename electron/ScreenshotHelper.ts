/**
 * =============================================================================
 * ScreenshotHelper.ts — CAPTURA DE TELA DO DESKTOP
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Gerencia toda a captura de tela do aplicativo. Suporta:
 * - Captura de tela inteira (todos os monitores)
 * - Captura de área selecionada (recorte manual)
 * - Múltiplos monitores com costura de imagens (stitching)
 * - Filas de captura para processamento posterior pelo LLM
 * 
 * FLUXO DE CAPTURA:
 * 1. Usuário pressiona atalho (Ctrl+Shift+S ou similar)
 * 2. ScreenshotHelper usa desktopCapturer.getSources() do Electron
 * 3. Captura thumbnail de cada monitor
 * 4. Se for seleção: recorta a área de interesse de cada monitor
 * 5. Costura (stitch) os pedaços se a seleção cruza monitores
 * 6. Salva como PNG no diretório de dados do app
 * 7. Retorna caminho + preview (base64) para o renderer
 * 
 * PERMISSÕES (macOS):
 * No macOS, o app precisa de permissão de "Screen Recording" (TCC).
 * Esta classe VERIFICA o status antes de capturar e lança erro claro
 * se a permissão estiver negada, em vez de retornar tela preta silenciosamente.
 * 
 * SUPORTE A MÚLTIPLOS MONITORES:
 * - Calcula interseção da seleção com cada monitor
 * - Usa source.display_id para mapear fontes para monitores
 * - Costura imagens com sharp (biblioteca de processamento de imagem)
 * - Suporta diferentes scale factors (Retina, 4K, etc.)
 * 
 * FORMATO DE SAÍDA:
 * - Sempre PNG (ScreenshotHelper produce exclusivamente .png)
 * - Salvo em: {userData}/screenshots/{timestamp}_{uuid}.png
 * - Preview: base64 da thumbnail para exibição rápida na UI
 * =============================================================================
 */

// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app, desktopCapturer, screen, systemPreferences } from "electron"
import { v4 as uuidv4 } from "uuid"
import util from "util"
import sharp from "sharp"
import { exec as execShell } from "child_process"

// Otimização extrema de RAM (Phase 1): desabilita o cache em C++ do Sharp 
// que causa memory leaks silenciosos ao fazer capturas sucessivas no Electron.
sharp.cache(false);

// Module-level: promisified shell exec created uma vez por processo lifetime.
// Uses o shell-capable exec variant (não execFile) porque Linux screenshot
// commands uso shell operators (||, 2>/dev/null) que exigir a shell interpreter.
const shellExecAsync = util.promisify(execShell);

/**
 * Asserts que macOS tela recording permissão é em a usable sestado
 *
 * Statuses:
 *   'granted'        → OK, proceed.
 *   'denied'         → User explicitly revoked aacesso Throw — cannot capture.
 *   'restricted'     → MDM / parental ccontrola Throw — cannot fix programmatically.
 *   'not-determined' → O startup flow em initializeApp() é responsible para
 *                      triggering o one-time TCC dialog. If we reach isso estado
 *                      at screenshot time it significa que startup diálogo era dismissed
 *                      ou failed. Throw a claro reiniciar prompt em vez than calling
 *                      getSources() novamente com não foreground janela ccontexto
 *
 * Em non-Darwin platforms isso é a no-op (sempre passes).
 */
function assertScreenRecordingPermission(): void {
  if (process.platform !== 'darwin') return;
  // Em development mmodo bypass o permissão verifica então screenshots work sem
  // needing o app para ser em o TCC whitelist (mesmo política como o startup verifica em main.ts).
  if (!app.isPackaged) return;
  const status = systemPreferences.getMediaAccessStatus('screen');
  switch (status) {
    case 'granted':
      return;
    case 'denied':
      throw new Error(
        'Screen Recording permission is denied. Enable it in System Settings > ' +
        'Privacy & Security > Screen Recording, then restart Refract.'
      );
    case 'restricted':
      throw new Error(
        'Screen Recording is restricted by a device policy (MDM or parental controls). ' +
        'Contact your administrator to allow screen capture.'
      );
    case 'not-determined':
      // O one-time TCC prompt deve ter fired at app startup (initializeApp).
      // If we land aqui it significa o prompt era cancelled/failed — a segundo
      // getSources() chamar sem a focused janela vai cria a worse UX (dialog
      // appears atrás outro apps em macOS Sequoia). Tell o user para reiniciar iem vez disso
      throw new Error(
        'Screen Recording permission has not been granted yet. ' +
        'Please restart Refract — you will be prompted to grant access on next launch.'
      );
  }
}

/**
 * Encontra o exibir que best contém o given rectangle.
 * Used para determine que monitorar para capture para a selection area.
 * Falls voltar para primário exibir se não corresponder é found.
 */
function getDisplayContainingRect(rect: Electron.Rectangle): Electron.Display {
  const displays = screen.getAllDisplays();
  
  // Encontra exibir que contém o centro point
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  
  for (const display of displays) {
    const { x: dx, y: dy, width, height } = display.bounds;
    if (centerX >= dx && centerX < dx + width && centerY >= dy && centerY < dy + height) {
      return display;
    }
  }
  
  // Verifica se qualquer part de o rect é em isso exibir
  for (const display of displays) {
    const { x: dx, y: dy, width, height } = display.bounds;
    const displayRight = dx + width;
    const displayBottom = dy + height;
    const rectRight = rect.x + rect.width;
    const rectBottom = rect.y + rect.height;
    
    // Verifica para overlap
    if (rect.x < displayRight && rectRight > dx && rect.y < displayBottom && rectBottom > dy) {
      return display;
    }
  }
  
  return screen.getPrimaryDisplay();
}


/**
 * Represents a portion de o selection que lies em a específico dexibir
 */
interface DisplayCapture {
  display: Electron.Display;
  /** O intersection de selection com isso exibir (em tela coordinates) */
  intersection: Electron.Rectangle;
  /** Buffer containing o cropped imagem dados */
  imageBuffer: Buffer;
}

/**
 * Calcula que exibe intersect com o given selection area.
 * Retorna an array de exibir captures com their intersection rectangles.
 */
async function getDisplaysIntersectingSelection(
  selection: Electron.Rectangle
): Promise<DisplayCapture[]> {
  // GProteger abortar early com a claro mensagem se tela recording é não allowed.
  // Sem isso cverifica getSources() Retorna black thumbnails silently — o mesmo
  // production bug que affected single-display captures (issue #133).
  assertScreenRecordingPermission();

  const displays = screen.getAllDisplays();
  const selectionRight = selection.x + selection.width;
  const selectionBottom = selection.y + selection.height;

  // Obtém todos tela sources para desktopCapturer
  let sources: Electron.DesktopCapturerSource[];

  // Determine appropriate thumbnail tamanho - uso largest exibir
  let maxWidth = 0;
  let maxHeight = 0;
  for (const display of displays) {
    const { width, height } = display.bounds;
    const scaledWidth = Math.round(width * display.scaleFactor);
    const scaledHeight = Math.round(height * display.scaleFactor);
    maxWidth = Math.max(maxWidth, scaledWidth);
    maxHeight = Math.max(maxHeight, scaledHeight);
  }

  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight }
    });
  } catch (error) {
    console.error('[ScreenshotHelper] Failed to get desktop sources:', error);
    throw error;
  }
  
  console.log(`[ScreenshotHelper] Found ${sources.length} screen sources for ${displays.length} displays`);
  
  // Build a mapa de fonte por display_id para reliable matching
  // Em Windows, source.display_id é a string representation de o exibir id
  const sourceByDisplayId = new Map<string, Electron.DesktopCapturerSource>();
  for (const src of sources) {
    if ('display_id' in src && src.display_id) {
      sourceByDisplayId.set(src.display_id, src);
      console.log(`[ScreenshotHelper] Registered source: ${src.name} with display_id: ${src.display_id}`);
    }
  }
  
  const captures: DisplayCapture[] = [];
  
  // Para cada dexibir verifica se selection intersects com it
  for (const display of displays) {
    const { x: dx, y: dy, width: dWidth, height: dHeight } = display.bounds;
    const displayRight = dx + dWidth;
    const displayBottom = dy + dHeight;
    
    // Verifica se selection intersects com isso exibir
    const intersectsX = selection.x < displayRight && selectionRight > dx;
    const intersectsY = selection.y < displayBottom && selectionBottom > dy;
    
    if (!intersectsX || !intersectsY) {
      continue;
    }
    
    // Calcula intersection
    const intersection: Electron.Rectangle = {
      x: Math.max(selection.x, dx),
      y: Math.max(selection.y, dy),
      width: Math.min(selectionRight, displayRight) - Math.max(selection.x, dx),
      height: Math.min(selectionBottom, displayBottom) - Math.max(selection.y, dy)
    };
    
    console.log(`[ScreenshotHelper] Selection intersects with display ${display.id}:`, intersection);
    
    const scaleFactor = display.scaleFactor;
    
    // Encontra o corresponding fonte using o pre-built mapa
    const displayIdStr = display.id.toString();
    let source = sourceByDisplayId.get(displayIdStr);
    
    // Fallback: index-based matching (menos reliable)
    if (!source) {
      console.warn(`[ScreenshotHelper] display_id ${displayIdStr} not found in sources, using index-based fallback`);
      const displayIndex = displays.findIndex(d => d.id === display.id);
      if (displayIndex === -1) {
        console.error(`[ScreenshotHelper] CRITICAL: Display ${display.id} not found in displays array. Available displays:`, displays.map(d => d.id));
      } else if (displayIndex >= sources.length) {
        console.warn(`[ScreenshotHelper] Index ${displayIndex} out of bounds for sources (${sources.length} sources). Using first source.`);
      } else {
        console.log(`[ScreenshotHelper] Fallback: matched display[${displayIndex}] to sources[${displayIndex}] = ${sources[displayIndex]?.name || 'unknown'}`);
      }
      source = sources[displayIndex] || sources[0];
    }
    
    if (!source) {
      source = sources[0];
    }
    
    console.log(`[ScreenshotHelper] Final source for display ${display.id}: ${source.name}`);
    
    // Obtém fonte thumbnail info
    const sourceSize = source.thumbnail.getSize();
    console.log(`[ScreenshotHelper] Source thumbnail size: ${sourceSize.width}x${sourceSize.height}, display bounds: ${display.bounds.width}x${display.bounds.height}`);
    
    // CRITICAL: desktopCapturer Retorna thumbnail em DISPLAY'S NATIVE resolution
    // Não scaled para a comum size. Different exibe pode ter diferente resolutions.
    // 
    // We precisa para normalizar crop coordinates para o thumbnail's coordinate system.
    // O ratio sourceSize / display.bounds gives nós o scaling factor.
    
    // Calcula o ratio entre thumbnail e exibir bounds
    // This accounts para qualquer difference em como desktopCapturer captures cada exibir
    let thumbnailToBoundsRatioX = display.bounds.width > 0 ? sourceSize.width / display.bounds.width : 1;
    let thumbnailToBoundsRatioY = display.bounds.height > 0 ? sourceSize.height / display.bounds.height : 1;
    
    // Proteger contra Infinity values (e.g., se sourceSize >> bounds due para DPI mismatch)
    const MAX_RATIO = 10;
    if (!isFinite(thumbnailToBoundsRatioX)) {
      console.warn(`[ScreenshotHelper] thumbnailToBoundsRatioX is ${thumbnailToBoundsRatioX}, clamping to ${MAX_RATIO}`);
      thumbnailToBoundsRatioX = MAX_RATIO;
    }
    if (!isFinite(thumbnailToBoundsRatioY)) {
      console.warn(`[ScreenshotHelper] thumbnailToBoundsRatioY is ${thumbnailToBoundsRatioY}, clamping to ${MAX_RATIO}`);
      thumbnailToBoundsRatioY = MAX_RATIO;
    }
    
    console.log(`[ScreenshotHelper] Thumbnail to bounds ratio: ${thumbnailToBoundsRatioX}x${thumbnailToBoundsRatioY}`);
    
    // Intersection coordinates são em tela coordinates (physical pixels)
    // We precisa para converte them para thumbnail coordinates
    const cropX = Math.round((intersection.x - display.bounds.x) * thumbnailToBoundsRatioX);
    const cropY = Math.round((intersection.y - display.bounds.y) * thumbnailToBoundsRatioY);
    const cropWidth = Math.round(intersection.width * thumbnailToBoundsRatioX);
    const cropHeight = Math.round(intersection.height * thumbnailToBoundsRatioY);
    
    console.log(`[ScreenshotHelper] Crop params: x=${cropX}, y=${cropY}, w=${cropWidth}, h=${cropHeight}`);
    
    // Garante crop é dentro de imagem bounds
    const clampedX = Math.max(0, Math.min(cropX, sourceSize.width));
    const clampedY = Math.max(0, Math.min(cropY, sourceSize.height));
    const clampedWidth = Math.max(0, Math.min(cropWidth, sourceSize.width - clampedX));
    const clampedHeight = Math.max(0, Math.min(cropHeight, sourceSize.height - clampedY));
    
    const cropped = source.thumbnail.crop({
      x: clampedX,
      y: clampedY,
      width: clampedWidth,
      height: clampedHeight
    });
    
    captures.push({
      display,
      intersection,
      imageBuffer: cropped.toPNG()
    });
  }
  
  return captures;
}

/**
 * Verifica se o selection spans múltiplos dexibe
 */
function isMultiDisplaySelection(selection: Electron.Rectangle): boolean {
  const displays = screen.getAllDisplays();
  
  if (displays.length < 2) {
    return false;
  }
  
  let displaysHit = 0;
  
  for (const display of displays) {
    const { x: dx, y: dy, width: dWidth, height: dHeight } = display.bounds;
    const displayRight = dx + dWidth;
    const displayBottom = dy + dHeight;
    
    const intersectsX = selection.x < displayRight && (selection.x + selection.width) > dx;
    const intersectsY = selection.y < displayBottom && (selection.y + selection.height) > dy;
    
    if (intersectsX && intersectsY) {
      displaysHit++;
    }
  }
  
  return displaysHit > 1;
}

/**
 * Stitches múltiplos exibir captures dentro de a único image.
 * Gerencia diferente DPI scales por normalizing todos captures para o mesmo physical pixel scale.
 */
async function stitchImages(captures: DisplayCapture[], selection: Electron.Rectangle): Promise<Buffer> {
  if (captures.length === 0) {
    throw new Error('No captures to stitch');
  }
  
  if (captures.length === 1) {
    // Single exibir - não stitching needed
    return captures[0].imageBuffer;
  }
  
  console.log(`[ScreenshotHelper] Stitching ${captures.length} display captures`);
  console.log(`[ScreenshotHelper] Selection bounds: x=${selection.x}, y=${selection.y}, width=${selection.width}, height=${selection.height}`);
  
  // Memory consideration: Todos capture buffers são held em memory até stitchImages ccompleta
  // Para 4K monitors, isso poderia significar ~33MB por capture × número de captures.
  // Example: 4 monitors × 4K × RGBA = ~132MB peak memory usage durante stitching.
  // Future optimization: Processo captures one at a time para reduzir peak memory.
  
  // Registrar cada capture's details
  for (let i = 0; i < captures.length; i++) {
    const cap = captures[i];
    console.log(`[ScreenshotHelper] Capture ${i}: display=${cap.display.id}, displayBounds=(${cap.display.bounds.x}, ${cap.display.bounds.y}, ${cap.display.bounds.width}x${cap.display.bounds.height})`);
    console.log(`[ScreenshotHelper] Capture ${i}: intersection=(${cap.intersection.x}, ${cap.intersection.y}, ${cap.intersection.width}x${cap.intersection.height})`);
  }
  
  // Saída dimensions em physical pixels (mesmo como selection)
  const outputWidth = Math.round(selection.width);
  const outputHeight = Math.round(selection.height);
  
  console.log(`[ScreenshotHelper] Output dimensions: ${outputWidth}x${outputHeight}`);
  
  // Processo cada capture: redimensionar para fit o saída scale
  const composites: sharp.OverlayOptions[] = [];
  
  try {
    for (const capture of captures) {
      // Calcula onde isso capture goes em saída coordinates (physical pixels)
      const outputOffsetX = Math.round(capture.intersection.x - selection.x);
      const outputOffsetY = Math.round(capture.intersection.y - selection.y);
      
      // Calcula o alvo tamanho para isso capture em saída coordinates
      const targetWidth = Math.round(capture.intersection.width);
      const targetHeight = Math.round(capture.intersection.height);
      
      // Obtém atual imagem dimensions
      const metadata = await sharp(capture.imageBuffer).metadata();
      const srcWidth = metadata.width || 1;
      const srcHeight = metadata.height || 1;
      
      console.log(`[ScreenshotHelper] Capture at (${outputOffsetX}, ${outputOffsetY}), source: ${srcWidth}x${srcHeight}, target: ${targetWidth}x${targetHeight}`);
      
      // Resize o capture para alvo dimensions para normalizar DPI scales
      const resizedBuffer = await sharp(capture.imageBuffer)
        .resize(targetWidth, targetHeight, { fit: 'fill' })
        .png()
        .toBuffer();
      
      composites.push({
        input: resizedBuffer,
        left: outputOffsetX,
        top: outputOffsetY
      });
      
      console.log(`[ScreenshotHelper] Resized capture to ${targetWidth}x${targetHeight}`);
    }
  } catch (error) {
    console.error('[ScreenshotHelper] Error processing capture buffers:', error);
    throw new Error(`Failed to process screenshot buffers: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  // Cria a transparent canvas de o saída tamanho e composite todos images
  let stitched: Buffer;
  try {
    stitched = await sharp({
      create: {
        width: outputWidth,
        height: outputHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite(composites)
    .png()
    .toBuffer();
  } catch (error) {
    console.error('[ScreenshotHelper] Error creating stitched image:', error);
    throw new Error(`Failed to create stitched screenshot: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  console.log(`[ScreenshotHelper] Stitched image created: ${outputWidth}x${outputHeight}`);
  
  return stitched;
}

export class ScreenshotHelper {
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private readonly MAX_SCREENSHOTS = 5

  private readonly screenshotDir: string
  private readonly extraScreenshotDir: string

  private view: "queue" | "solutions" = "queue"

  constructor(view: "queue" | "solutions" = "queue") {
    this.view = view

    // Inicializa directories
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra_screenshots"
    )

    // Cria directories se they don't exist
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir)
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir)
    }
  }

  /**
   * Captures a screenshot using Electron's native desktopCapturer API.
   * Supports multi-monitor setups by selecting o appropriate exibir source.
   *
   * @param outputPath Path para salvar o PNG file
   * @param area Optional rectangle para crop o screenshot (in tela coordinates)
   * @throws Error se tela capture fails ou permissions are denied
   */
  private async captureWithDesktopCapturer(
    outputPath: string,
    area?: Electron.Rectangle,
    preferredDisplay?: Electron.Display
  ): Promise<void> {
    // Abortar early se tela recording é não usable. assertScreenRecordingPermission()
    // covers todos macOS TCC states (denied, restricted, not-determined) com claro
    // user-facing messages. Em non-Darwin platforms isso é a no-op.
    assertScreenRecordingPermission();

    let targetDisplay: Electron.Display;

    if (preferredDisplay) {
      targetDisplay = preferredDisplay;
    } else if (area) {
      // Encontra que exibir contém o selection area
      targetDisplay = getDisplayContainingRect(area);
    } else {
      targetDisplay = screen.getPrimaryDisplay();
    }
    
    const { scaleFactor } = targetDisplay;
    const displayBounds = targetDisplay.bounds;
    
    console.log(`[ScreenshotHelper] Target display bounds: ${JSON.stringify(displayBounds)}, scale: ${scaleFactor}`);
    
    let sources: Electron.DesktopCapturerSource[];

    try {
      // thumbnailSize: uso o display's logical resolution.
      // Electron's DesktopCapturer já Retorna native-pixel-density images
      // independentemente de o requested size. Requesting w×scaleFactor forces it to
      // decodificar a 2×–3× larger texture (e.g. 5120×3200 em a Retina 2× dexibir
      // em a blocking main-thread call, adding 50–200ms de latency com zero
      // image-quality benefit desde we imediatamente escreve o result para PNG.
      const thumbnailSize = {
        width: displayBounds.width,
        height: displayBounds.height
      };

      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize
      });
      console.log(`[ScreenshotHelper] Found ${sources.length} screen source(s)`);
    } catch (error) {
      console.error('[ScreenshotHelper] desktopCapturer.getSources failed:', error);
      // Handle específico erro types
      if ((error as NodeJS.ErrnoException).name === 'NotAllowedError') {
        // Apenas macOS tem a TCC-style Screen Recording permissão pane.
        // Em Windows/Linux NotAllowedError de desktopCapturer tipicamente
        // significa o compositor refused o requisição — não a user-fixable
        // OS permissão — então we surface a platform-neutral mmensagem
        throw new Error(
          process.platform === 'darwin'
            ? 'Screen capture permission denied. Please grant screen recording permission in System Settings > Privacy & Security > Screen Recording.'
            : 'Screen capture permission denied by the OS. Please try again or restart Refract.'
        );
      }
      if ((error as NodeJS.ErrnoException).name === 'NotFoundError') {
        throw new Error('No screen sources available. Please ensure at least one display is connected.');
      }
      throw new Error(`Failed to capture screen: ${(error as Error).message}`);
    }

    if (sources.length === 0) {
      console.error('[ScreenshotHelper] No screen sources found');
      throw new Error(
        process.platform === 'darwin'
          ? 'No screen sources available. Check screen recording permissions in System Settings > Privacy & Security > Screen Recording.'
          : 'No screen sources available. Please ensure at least one display is connected.'
      );
    }

    // Encontra o fonte matching nosso alvo exibir using reliable display_id mapping
    const targetDisplayId = targetDisplay.id.toString();
    let selectedSource: Electron.DesktopCapturerSource | null = null;
    
    // Build a mapa de sources por display_id (mesmo logic como em getDisplaysIntersectingSelection)
    for (const source of sources) {
      if ('display_id' in source && source.display_id) {
        console.log(`[ScreenshotHelper] Source: ${source.name}, display_id: ${source.display_id}`);
        if (source.display_id === targetDisplayId) {
          selectedSource = source;
          console.log(`[ScreenshotHelper] Matched source by display_id: ${source.display_id}`);
        }
      }
    }
    
    // Último resort: uso primeiro fonte
    if (!selectedSource) {
      console.warn(`[ScreenshotHelper] display_id ${targetDisplayId} not found in sources, using first available`);
      selectedSource = sources[0];
    }
    
    console.log(`[ScreenshotHelper] Final source: ${selectedSource.name} (id: ${selectedSource.id})`);
    
    let image = selectedSource.thumbnail;

    if (area) {
      // Crop rect: area é em absolute tela coordinates. O returned thumbnail
      // é em native device pixels (Electron scales it para cima internally), então we
      // precisa aplica scaleFactor para mapa de logical tela coords para pixel coords.
      const cropX = Math.round((area.x - displayBounds.x) * scaleFactor);
      const cropY = Math.round((area.y - displayBounds.y) * scaleFactor);

      const croppedArea = {
        x: Math.max(0, cropX),
        y: Math.max(0, cropY),
        width: Math.round(area.width * scaleFactor),
        height: Math.round(area.height * scaleFactor)
      };
      
      console.log(`[ScreenshotHelper] Cropping relative to display: ${JSON.stringify(croppedArea)}`);
      
      // Garante crop area é dentro de imagem bounds
      const imgWidth = image.getSize().width;
      const imgHeight = image.getSize().height;
      
      if (croppedArea.x + croppedArea.width > imgWidth) {
        croppedArea.width = imgWidth - croppedArea.x;
      }
      if (croppedArea.y + croppedArea.height > imgHeight) {
        croppedArea.height = imgHeight - croppedArea.y;
      }
      
      if (croppedArea.width > 0 && croppedArea.height > 0) {
        image = image.crop(croppedArea);
      } else {
        console.warn('[ScreenshotHelper] Invalid crop area, skipping crop');
      }
    }

    try {
      await fs.promises.writeFile(outputPath, image.toPNG());
      console.log(`[ScreenshotHelper] Screenshot saved to: ${outputPath}`);
    } catch (writeError) {
      console.error('[ScreenshotHelper] Failed to write screenshot to disk:', writeError);
      throw new Error(`Failed to save screenshot: ${(writeError as Error).message}`);
    }
  }

  /**
   * Captures a virtual tela region by reading o intersecting displays e stitching them.
   */
  private async captureStitchedDesktopArea(outputPath: string, area: Electron.Rectangle): Promise<void> {
    const captures = await getDisplaysIntersectingSelection(area);
    const stitchedBuffer = await stitchImages(captures, area);
    await fs.promises.writeFile(outputPath, stitchedBuffer);
    console.log(`[ScreenshotHelper] Stitched screenshot saved to: ${outputPath}`);
  }

  /**
   * Platform-aware screenshot command builder.
   * Linux-only in practice. macOS e Windows use desktopCapturer APIs instead.
   */
  private getScreenshotCommand(outputPath: string, interactive: boolean): string {
    // Safety: outputPath precisa ser dentro de nosso controlled directories.
    // Desde we sempre construct paths using path.join(this.screenshotDir, uuidv4()),
    // isso assertion guards contra qualquer future regression onde external entrada poderia reach haqui
    // This é a defense-in-depth measure contra caminho traversal attacks.
    const userDataDir = app.getPath('userData');
    if (!outputPath.startsWith(userDataDir)) {
      throw new Error(`[ScreenshotHelper] Refusing shell command for path outside userData: ${outputPath}`);
    }
    const safePath = outputPath.replace(/"/g, '\\"');
    const platform = process.platform;
    if (platform === 'linux') {
      return interactive
        ? `gnome-screenshot -a -f "${safePath}" 2>/dev/null || scrot -s "${safePath}" 2>/dev/null || import "${safePath}"`
        : `gnome-screenshot -f "${safePath}" 2>/dev/null || scrot "${safePath}" 2>/dev/null || import -window root "${safePath}"`;
    }
    throw new Error(`Unsupported platform for screenshots: ${platform}`);
  }

  public async takeScreenshot(preferredDisplay?: Electron.Display): Promise<string> {
    try {
      console.log('[ScreenshotHelper] Taking screenshot...');

      let screenshotPath = ""

      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
        console.log(`[ScreenshotHelper] Using queue directory: ${screenshotPath}`);
        if (process.platform === 'darwin') {
          await this.captureWithDesktopCapturer(screenshotPath, undefined, preferredDisplay);
        } else if (process.platform === 'win32') {
          await this.captureWithDesktopCapturer(screenshotPath);
        } else {
          await shellExecAsync(this.getScreenshotCommand(screenshotPath, false))
        }

        this.screenshotQueue.push(screenshotPath)
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
              console.log(`[ScreenshotHelper] Removed old screenshot: ${removedPath}`);
            } catch (error) {
              console.warn(`[ScreenshotHelper] Failed to remove old screenshot: ${removedPath}`, error)
            }
          }
        }
      } else {
        screenshotPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`)
        console.log(`[ScreenshotHelper] Using extra screenshots directory: ${screenshotPath}`);
        if (process.platform === 'darwin') {
          await this.captureWithDesktopCapturer(screenshotPath, undefined, preferredDisplay);
        } else if (process.platform === 'win32') {
          await this.captureWithDesktopCapturer(screenshotPath);
        } else {
          await shellExecAsync(this.getScreenshotCommand(screenshotPath, false))
        }

        this.extraScreenshotQueue.push(screenshotPath)
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift()
          if (removedPath) {
            try {
              await fs.promises.unlink(removedPath)
              console.log(`[ScreenshotHelper] Removed old extra screenshot: ${removedPath}`);
            } catch (error) {
              console.warn(`[ScreenshotHelper] Failed to remove old extra screenshot: ${removedPath}`, error)
            }
          }
        }
      }

      console.log(`[ScreenshotHelper] Screenshot successful: ${screenshotPath}`);
      return screenshotPath
    } catch (error) {
      console.error('[ScreenshotHelper] Failed to take screenshot:', error);
      throw new Error(`Failed to take screenshot: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  public async takeSelectiveScreenshot(captureArea?: Electron.Rectangle): Promise<string> {
    try {
      console.log('[ScreenshotHelper] Taking selective screenshot...');
      console.log(`[ScreenshotHelper] Capture area: ${captureArea ? JSON.stringify(captureArea) : 'user selection'}`);

      const screenshotPath = path.join(this.screenshotDir, `selective-${uuidv4()}.png`)

      if ((process.platform === 'win32' || process.platform === 'darwin') && captureArea) {
        // Verifica se selection spans múltiplos exibe
        const isMulti = isMultiDisplaySelection(captureArea);

        if (isMulti) {
          console.log('[ScreenshotHelper] Selection spans multiple displays - using stitched capture');
          await this.captureStitchedDesktopArea(screenshotPath, captureArea);
        } else {
          console.log('[ScreenshotHelper] Selection within single display - using standard capture');
          await this.captureWithDesktopCapturer(screenshotPath, captureArea);
        }
      } else if (process.platform === 'linux') {
        // Linux: uso interactive selection comando
        console.log('[ScreenshotHelper] Using interactive selection');
        try {
          await shellExecAsync(this.getScreenshotCommand(screenshotPath, true))
        } catch (e: any) {
          console.warn('[ScreenshotHelper] User cancelled selection or error occurred:', e);
          throw new Error("Selection cancelled")
        }
      } else {
        throw new Error('Selection bounds are required for this platform');
      }

      // Verifica arquivo exists (user pode ser ter pressed Esc)
      if (!fs.existsSync(screenshotPath)) {
        console.warn('[ScreenshotHelper] Screenshot file not found after selection');
        throw new Error("Selection cancelled")
      }

      console.log(`[ScreenshotHelper] Selective screenshot successful: ${screenshotPath}`);

      // Adiciona para fila então it appears em getScreenshots() e respects o cap
      this.screenshotQueue.push(screenshotPath);
      if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
        const removedPath = this.screenshotQueue.shift();
        if (removedPath) {
          try {
            await fs.promises.unlink(removedPath);
          } catch {
            // best-effort cleanup
          }
        }
      }

      return screenshotPath
    } catch (error) {
      console.error('[ScreenshotHelper] Failed to take selective screenshot:', error);
      throw error
    }
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotQueue
  }

  public getExtraScreenshotQueue(): string[] {
    return this.extraScreenshotQueue
  }

  public clearQueues(): void {
    // Limpa screenshotQueue
    this.screenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err) {
          // console.error(`Error deleting screenshot at ${screenshotPath}:`, err)
        }
      })
    })
    this.screenshotQueue = []

    // Limpa extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      fs.unlink(screenshotPath, (err) => {
        if (err) {
          // console.error(
          //   `Error deleting extra screenshot at ${screenshotPath}:`,
          //   err
          // )
        }
      })
    })
    this.extraScreenshotQueue = []
  }

  public async getImagePreview(filepath: string): Promise<string> {
    const maxRetries = 20
    const delay = 250 // 5s total aguardar time

    for (let i = 0; i < maxRetries; i++) {
      try {
        if (fs.existsSync(filepath)) {
          // Duplo verifica arquivo tamanho é > 0
          const stats = await fs.promises.stat(filepath)
          if (stats.size > 0) {
            const data = await fs.promises.readFile(filepath)
            return `data:image/png;base64,${data.toString("base64")}`
          }
        }
      } catch (error) {
        // console.log(`[ScreenshotHelper] Retry ${i + 1}/${maxRetries} failed:`, error)
      }
      // Aguardar para arquivo system
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    throw new Error(`Failed to read screenshot after ${maxRetries} retries (${maxRetries * delay}ms): ${filepath}`)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await fs.promises.unlink(path)
      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        )
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        )
      }
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('[ScreenshotHelper] deleteScreenshot failed:', msg);
      return { success: false, error: msg };
    }
  }
}
