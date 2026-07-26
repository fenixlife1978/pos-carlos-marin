const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } = require('node-thermal-printer');
const fs = require('fs');

// ============================================================
// FORZAR ZONA HORARIA DE VENEZUELA
// ============================================================
app.commandLine.appendSwitch('timezone', 'America/Caracas');

// ============================================================
// REGISTRAR PROTOCOLO SEGURO 'app' (VITAL PARA OFFLINE)
// ============================================================
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// ============================================================
// CONFIGURACIÓN DE IMPRESIÓN (sin driver explícito)
// ============================================================
const PRINTER_CONFIG = {
  type: PrinterTypes.STAR,
  interface: 'printer:POS-80',
  characterSet: CharacterSet.PC852_LATIN2,
  breakLine: BreakLine.WORD,
};

// ============================================================
// MANEJADOR DE IMPRESIÓN
// ============================================================
async function handlePrintTicket(_event, ticketString) {
  try {
    const printer = new ThermalPrinter(PRINTER_CONFIG);
    const isConnected = await printer.isPrinterConnected();

    if (!isConnected) {
      throw new Error('Impresora no conectada o nombre incorrecto.');
    }

    printer.clear();
    printer.append(ticketString);
    await printer.execute();

    console.log('✅ Impresión completada');
    return { success: true };
  } catch (error) {
    console.error('❌ Error de impresión:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// MANEJADOR DE VERSIÓN
// ============================================================
function handleGetAppVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ============================================================
// CREACIÓN DE VENTANA PRINCIPAL
// ============================================================
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    icon: path.join(__dirname, '../public/posven-logo.png'),
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    win.loadURL('http://localhost:9002');
    win.webContents.openDevTools();
  } else {
    // ✅ CORRECCIÓN: Usar protocolo 'app' en lugar de loadFile
    win.loadURL('app://-');
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  // Capturar errores de renderizado
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('❌ Error al cargar la página:', errorCode, errorDescription);
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('🖥️ Renderizado:', message);
  });

  win.on('closed', () => {});

  return win;
}

// ============================================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ============================================================
app.whenReady().then(() => {
  // ✅ Manejador de protocolo 'app' para servir archivos estáticos
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    let pathname = url.pathname;

    if (pathname === "/" || pathname === "") {
      pathname = "/index.html";
    } else if (!path.extname(pathname)) {
      pathname = path.join(pathname, "index.html");
    }

    // 🔑 Ruta CORRECTA: 'out' está en la raíz del proyecto
    const filePath = path.join(__dirname, "..", "out", pathname);
    console.log('📁 Sirviendo archivo:', filePath);
    
    try {
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      console.error('❌ Error al servir archivo:', error);
      // Fallback: intentar desde resourcesPath
      const fallbackPath = path.join(process.resourcesPath, 'app.asar', 'out', pathname);
      console.log('📁 Intentando fallback:', fallbackPath);
      return net.fetch(pathToFileURL(fallbackPath).toString());
    }
  });

  // Registrar handlers IPC
  ipcMain.handle('print-ticket', handlePrintTicket);
  ipcMain.handle('get-app-version', handleGetAppVersion);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================================
// ACTUALIZACIONES AUTOMÁTICAS (opcional)
// ============================================================
// const { autoUpdater } = require('electron-updater');
// app.whenReady().then(() => {
//   if (app.isPackaged) {
//     autoUpdater.checkForUpdatesAndNotify();
//   }
// });