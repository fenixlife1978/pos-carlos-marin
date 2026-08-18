'use client';

import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import { Collections } from '@/lib/db-store';

// Colecciones raíz donde viven los datos transaccionales (cada doc tiene su `id`).
// El `Collections.set(collectionName, docId, data)` escribe cuales en Firestore.
const COLLECTION_KEYS = [
  'productos', 'ventas', 'cxc', 'cxp', 'clientes', 'devoluciones', 'anulaciones',
  'movimientos', 'libroDiario', 'terminales', 'reportesZ', 'compras',
] as const;

export interface BackupFile {
  app: 'posven-pro';
  version: number;
  createdAt: string;
  collections: Record<string, any[]>;
  config: Record<string, unknown>;
  users: any[];
}

// Lee el doc de configuración global completo (tasa, empresa, catálogos,
// acumulados, fondo de caja, contadores, config de impuestos, etc.).
async function leerConfig(): Promise<Record<string, unknown>> {
  try {
    const snap = await getDoc(doc(db, 'config', 'global'));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : {};
  } catch (e) {
    console.error('backup: no se pudo leer config/global', e);
    return {};
  }
}

// Crea el objeto de respaldo con TODA la información del sistema.
export async function crearRespaldo(): Promise<BackupFile> {
  const collections: Record<string, any[]> = {};
  await Promise.all(
    COLLECTION_KEYS.map(async (name) => {
      try {
        collections[name] = await Collections.getAll(name);
      } catch (e) {
        console.error(`backup: no se pudo leer ${name}`, e);
        collections[name] = [];
      }
    })
  );

  let users: any[] = [];
  try {
    const snap = await getDocs(collection(db, 'users'));
    users = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('backup: no se pudieron leer usuarios', e);
    users = [];
  }

  return {
    app: 'posven-pro',
    version: 1,
    createdAt: new Date().toISOString(),
    collections,
    config: await leerConfig(),
    users,
  };
}

// Descarga el respaldo como archivo .json en el navegador.
export function descargarRespaldo(backup: BackupFile) {
  const nombre = `Respaldo_POSVEN_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Lee y valida un archivo de respaldo subido.
export async function leerArchivoRespaldo(file: File): Promise<BackupFile | null> {
  if (!file) return null;
  const text = await file.text();
  const parsed = JSON.parse(text) as BackupFile;
  if (!parsed || parsed.app !== 'posven-pro' || typeof parsed.collections !== 'object') {
    throw new Error('El archivo no es un respaldo válido de POSVEN-Pro.');
  }
  return parsed;
}

// Restaura completamente el sistema a partir de un respaldo: reescribe todas
// las colecciones raíz, la configuración global y los usuarios.
export async function restaurarRespaldo(backup: BackupFile): Promise<void> {
  const colecciones = backup.collections || {};
  const config = backup.config || {};

  // 1) Configuración global (config/global)
  if (Object.keys(config).length > 0) {
    await setDoc(doc(db, 'config', 'global'), config, { merge: true });
  }

  // 2) Colecciones raíz: cada doc se escribe con su propio id determinístico.
  //    Se usa Collections.set para reutilizar la misma vía de escritura de la app.
  for (const name of COLLECTION_KEYS) {
    const items = (colecciones[name] || []) as any[];
    if (items.length === 0) continue;
    await Promise.all(
      items.map(async (item) => {
        const id = item?.id || undefined;
        if (!id) return;
        const { id: _omit, ...data } = item;
        await Collections.set(name, id, data);
      })
    );
  }

  // 3) Usuarios
  const users = backup.users || [];
  if (users.length > 0) {
    await Promise.all(
      users.map(async (u) => {
        const id = u?.id || u?.uid;
        if (!id) return;
        const { id: _omit, ...perfil } = u;
        await setDoc(doc(db, 'users', String(id)), perfil, { merge: true });
      })
    );
  }
}

// Restaura desde el botón "Cargar Respaldo" (recibe un File).
export async function cargarRespaldoDesdeArchivo(file: File): Promise<void> {
  const backup = await leerArchivoRespaldo(file);
  if (!backup) return;
  await restaurarRespaldo(backup);
}