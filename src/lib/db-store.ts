'use client';

import { AppState } from './types';
import { db } from './firebase';
import { 
  doc, 
  setDoc, 
  onSnapshot, 
  collection, 
  query, 
  where, 
  limit, 
  getDocs, 
  updateDoc, 
  deleteDoc,
  deleteField,
  CollectionReference,
  Query,
  DocumentData
} from "firebase/firestore";

const STORAGE_KEY = 'posven_pro_config_cache';
const CONFIG_COLLECTION = 'config';
const CONFIG_DOC = 'global';
const PROVIDERS_COLLECTION = 'proveedores';

// 🔑 SOLO estas claves de CONFIGURACIÓN se persisten en config/global.
// Los datos transaccionales (ventas, movimientos, cxc, cxp, productos,
// clientes, compras, etc.) viven EXCLUSIVAMENTE en colecciones raíz.
const CONFIG_KEYS = [
  'tasa', 'comisionEfectivo', 'pinDevolucion', 'isInitialized',
  'empresa',
  'departamentos', 'categorias', 'marcas', 'presentaciones',
  'ultimoZ', 'proximoRecibo', 'proximaDevolucion', 'proximaAnulacion',
  'acumuladoHistorico', 'fechaUltimoZ',
  'fondoCajaHoyUSD', 'fondoCajaHoyBS',
  'isCashOpen',
  'config',
  'productCategories', 'productUnits', 'productColors', 'productSizes',
  'brands', 'groups', 'subgroups', 'lines', 'suppliers',
  'marcasString'
];

// 🔑 Claves que NUNCA deben vivir en config/global (auto-limpiadas si quedaron ahí).
const TRANSACTIONAL_KEYS = [
  'productos', 'ventas', 'cxc', 'cxp', 'clientes', 'devoluciones',
  'anulaciones', 'movimientos', 'libroDiario', 'terminales', 'reportesZ',
  'cashData', 'cashHistory', 'user', 'isAuthenticated'
];

export const initialState: AppState = {
  user: null,
  isAuthenticated: false,
  tasa: 36.50,
  comisionEfectivo: 5,
  pinDevolucion: '000000',
  isInitialized: false,
  productos: [],
  ventas: [],
  cxc: [],
  cxp: [],
  clientes: [],
  devoluciones: [],
  anulaciones: [],
  movimientos: [],
  libroDiario: [],
  carrito: [],
  terminales: [],
  reportesZ: [],
  ultimoZ: 0,
  proximoRecibo: 1,
  proximaDevolucion: 1,
  proximaAnulacion: 1,
  acumuladoHistorico: 0,
  fechaUltimoZ: '',
  fondoCajaHoyUSD: 0,
  fondoCajaHoyBS: 0,
  
  isCashOpen: false,
  cashData: null,
  cashHistory: [],
  
  empresa: { 
    nombre: 'NOMBRE DE SU NEGOCIO', 
    rif: 'J-00000000-0', 
    direccion: 'DIRECCIÓN FISCAL', 
    telefono: '0000-0000000' 
  },
  departamentos: ['Licores', 'Viveres', 'Otros'],
  categorias: ['Ron', 'Vino', 'Cerveza', 'Whisky', 'Refrescos', 'Otros'],
  marcas: ['Genérica'],
  presentaciones: ['750ml', '1L', 'Unidad', 'Caja'],
  proveedores: [],
  
  config: {
    exchangeRate: 36.50,
    ivaRate: 16,
    igtfRate: 3
  },
  
  productCategories: ['Repuesto', 'Lubricante', 'Filtro', 'Químico', 'Accesorio', 'Batería', 'Caucho', 'Freno', 'Suspensión', 'Motor', 'Eléctrico', 'Transmisión', 'Servicio'],
  productUnits: ['unidad', 'litro', 'galón', 'cuarto', 'paila', 'kit', 'juego', 'par', 'metro', 'kilogramo', 'gramo', 'tambor'],
  productColors: ['No Aplica', 'Negro', 'Gris', 'Cromo', 'Rojo', 'Azul', 'Blanco', 'Ámbar'],
  productSizes: ['N/A', 'Estándar', '0.10', '0.20', '0.30', '0.40', '0.50', '20', '30', '40', '50', '60'],
  
  brands: [],
  groups: [],
  subgroups: [],
  lines: [],
  suppliers: [],
  products: [],
  marcasString: ['Genérica'],
  proveedoresString: [],
};

// ============================================================
// STORE: Solo maneja CONFIGURACIÓN (no datos transaccionales)
// ============================================================
export const Store = {
  subscribe(callback: (state: Partial<AppState>) => void) {
    if (typeof window === 'undefined' || !db) return () => {};

    const docRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
    
    return onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        const val = snapshot.data();

        // Solo mezclamos la configuración, no los arrays de datos
        const configData = {
          tasa: val.tasa ?? initialState.tasa,
          comisionEfectivo: val.comisionEfectivo ?? initialState.comisionEfectivo,
          pinDevolucion: val.pinDevolucion ?? initialState.pinDevolucion,
          isInitialized: val.isInitialized ?? false,
          empresa: val.empresa ?? initialState.empresa,
          departamentos: val.departamentos ?? initialState.departamentos,
          categorias: val.categorias ?? initialState.categorias,
          marcas: val.marcas ?? initialState.marcas,
          presentaciones: val.presentaciones ?? initialState.presentaciones,
          proveedores: val.proveedores ?? initialState.proveedores,
          ultimoZ: val.ultimoZ ?? 0,
          proximoRecibo: val.proximoRecibo ?? 1,
          proximaDevolucion: val.proximaDevolucion ?? 1,
          proximaAnulacion: val.proximaAnulacion ?? 1,
          acumuladoHistorico: val.acumuladoHistorico ?? 0,
          fechaUltimoZ: val.fechaUltimoZ ?? '',
          fondoCajaHoyUSD: val.fondoCajaHoyUSD ?? 0,
          fondoCajaHoyBS: val.fondoCajaHoyBS ?? 0,
          isCashOpen: val.isCashOpen ?? false,
          config: val.config ?? initialState.config,
          productCategories: val.productCategories ?? initialState.productCategories,
          productUnits: val.productUnits ?? initialState.productUnits,
          productColors: val.productColors ?? initialState.productColors,
          productSizes: val.productSizes ?? initialState.productSizes,
          brands: val.brands ?? [],
          groups: val.groups ?? [],
          subgroups: val.subgroups ?? [],
          lines: val.lines ?? [],
          suppliers: val.suppliers ?? [],
          marcasString: val.marcasString ?? ['Genérica'],
          proveedoresString: val.proveedoresString ?? [],
        };
        callback(configData);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(configData));
      } else {
        const local = Store.get();
        callback(local);
        // Si no existe, crear con valores por defecto (solo configuración)
        const toPersist = {
          tasa: initialState.tasa,
          comisionEfectivo: initialState.comisionEfectivo,
          pinDevolucion: initialState.pinDevolucion,
          isInitialized: false,
          empresa: initialState.empresa,
          departamentos: initialState.departamentos,
          categorias: initialState.categorias,
          marcas: initialState.marcas,
          presentaciones: initialState.presentaciones,
          proveedores: initialState.proveedores,
          ultimoZ: 0,
          proximoRecibo: 1,
          proximaDevolucion: 1,
          proximaAnulacion: 1,
          acumuladoHistorico: 0,
          fechaUltimoZ: '',
          fondoCajaHoyUSD: 0,
          fondoCajaHoyBS: 0,
          isCashOpen: false,
          config: initialState.config,
          productCategories: initialState.productCategories,
          productUnits: initialState.productUnits,
          productColors: initialState.productColors,
          productSizes: initialState.productSizes,
          brands: [],
          groups: [],
          subgroups: [],
          lines: [],
          suppliers: [],
          marcasString: ['Genérica'],
          proveedoresString: [],
        };
        if (db) setDoc(doc(db, CONFIG_COLLECTION, CONFIG_DOC), toPersist).catch(e => console.error("Error init config:", e));
      }
    }, (error) => {
      if (error.code !== 'permission-denied') {
        console.warn("Config Sync Warning:", error);
      }
      callback(Store.get());
    });
  },

  get(): Partial<AppState> {
    if (typeof window === 'undefined') return { ...initialState };
    const d = sessionStorage.getItem(STORAGE_KEY);
    if (!d) return { ...initialState };
    try {
      const parsed = JSON.parse(d);
      return { ...initialState, ...parsed };
    } catch {
      return { ...initialState };
    }
  },

  async set(state: Partial<AppState>) {
    if (typeof window === 'undefined') return;
    if (!state || typeof state !== 'object' || Array.isArray(state)) return;
    
    // 🔑 FILTRAR CAMPOS UNDEFINED Y SOLO PERMITIR CLAVES DE CONFIGURACIÓN.
    // Así config/global jamás recibe datos transaccionales (ventas, movimientos,
    // cxc, productos, etc.) aunque los módulos pasen el estado completo.
    const filteredState = Object.fromEntries(
      Object.entries(state).filter(([k, v]) => v !== undefined && CONFIG_KEYS.includes(k))
    );
    
    // 🔑 Merge con initialState (siempre valores por defecto)
    const dataToPersist = {
      tasa: initialState.tasa,
      comisionEfectivo: initialState.comisionEfectivo,
      pinDevolucion: initialState.pinDevolucion,
      isInitialized: initialState.isInitialized ?? true,
      empresa: initialState.empresa,
      departamentos: initialState.departamentos,
      categorias: initialState.categorias,
      marcas: initialState.marcas,
      presentaciones: initialState.presentaciones,
      proveedores: initialState.proveedores,
      ultimoZ: 0,
      proximoRecibo: 1,
      proximaDevolucion: 1,
      proximaAnulacion: 1,
      acumuladoHistorico: 0,
      fechaUltimoZ: '',
      fondoCajaHoyUSD: 0,
      fondoCajaHoyBS: 0,
      isCashOpen: false,
      config: initialState.config,
      productCategories: initialState.productCategories,
      productUnits: initialState.productUnits,
      productColors: initialState.productColors,
      productSizes: initialState.productSizes,
      brands: [],
      groups: [],
      subgroups: [],
      lines: [],
      suppliers: [],
      marcasString: ['Genérica'],
      proveedoresString: [],
      // Sobrescribir con los valores que vinieron (filtrados)
      ...filteredState,
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataToPersist));
    
    if (db) {
      const docRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      return await setDoc(docRef, dataToPersist);
    }
  },

  uid(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  }
};

// ============================================================
// COLLECTIONS: Helpers para leer/escribir en colecciones raíz
// ============================================================
export const Collections = {
  async set(collectionName: string, docId: string, data: any) {
    if (!db) return;
    await setDoc(doc(db, collectionName, docId), data);
  },

  async update(collectionName: string, docId: string, data: any) {
    if (!db) return;
    await updateDoc(doc(db, collectionName, docId), data);
  },

  async delete(collectionName: string, docId: string) {
    if (!db) return;
    await deleteDoc(doc(db, collectionName, docId));
  },

  subscribeAll(collectionName: string, callback: (data: any[]) => void, limitCount?: number) {
    if (!db) return () => {};
    let ref: CollectionReference | Query = collection(db, collectionName);
    if (limitCount) ref = query(ref, limit(limitCount));
    return onSnapshot(ref, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      callback(list);
    });
  },

  subscribeWhere(collectionName: string, field: string, operator: any, value: any, callback: (data: any[]) => void) {
    if (!db) return () => {};
    const ref = query(collection(db, collectionName), where(field, operator, value));
    return onSnapshot(ref, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      callback(list);
    });
  },

  subscribeWhereLimit(collectionName: string, field: string, operator: any, value: any, callback: (data: any[]) => void, limitCount: number) {
    if (!db) return () => {};
    const ref = query(collection(db, collectionName), where(field, operator, value), limit(limitCount));
    return onSnapshot(ref, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      callback(list);
    });
  },

  async getAll(collectionName: string) {
    if (!db) return [];
    const snapshot = await getDocs(collection(db, collectionName));
    const list: any[] = [];
    snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    return list;
  },

  async getWhere(collectionName: string, field: string, operator: any, value: any) {
    if (!db) return [];
    const q = query(collection(db, collectionName), where(field, operator, value));
    const snapshot = await getDocs(q);
    const list: any[] = [];
    snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    return list;
  }
};

export const Utils = {
  getVzlaDate: () => {
    const d = new Date();
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'America/Caracas',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(d);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value;
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}.${ms}`;
  },
  hoy: () => Utils.getVzlaDate().slice(0, 10),
  ahora: () => Utils.getVzlaDate(),
  round: (v: any) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : Math.round((n + Number.EPSILON) * 100) / 100;
  },
  fmtUSD: (v: number) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtBS: (v: number, symbol = true) => (symbol ? 'Bs. ' : '') + Number(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtMono: (v: number, prefix = false) => (prefix ? '$' : '') + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  fmtFecha: (f: string) => {
    if (!f) return '-';
    const datePart = f.includes('T') ? f.split('T')[0] : f;
    const p = datePart.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  },
  metodoLabel: (m: string) => {
    const map: Record<string, string> = { 
      efectivo_usd: 'Efectivo USD', 
      efectivo_bs: 'Efectivo Bs.', 
      punto_venta: 'Punto de Venta', 
      biopago: 'Biopago',
      pagomovil: 'PagoMovil',
      zelle: 'Zelle',
      credito: 'Crédito', 
      mixto: 'Mixto',
      nota_credito: 'Vale / Nota Crédito',
      otros: 'Otros'
    };
    return map[m] || m;
  }
};

// ============================================================
// LIMPIEZA MANUAL DE config/global
// ============================================================
// Elimina ÚNICAMENTE los arrays transaccionales heredados de
// config/global (ventas, movimientos, cxc, productos, etc.),
// conservando los campos de configuración. Los datos transaccionales
// viven en sus colecciones raíz; se debe ejecutar tras verificar/backup.
export const limpiarConfigGlobal = async (): Promise<number> => {
  if (!db) return 0;
  const docRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
  const snap = await getDocs(collection(db, CONFIG_COLLECTION));
  const docSnap = snap.docs.find(d => d.id === CONFIG_DOC);
  if (!docSnap) return 0;

  const val = docSnap.data();
  const presentes = TRANSACTIONAL_KEYS.filter(k => val[k] !== undefined);
  if (presentes.length === 0) return 0;

  const delObj: Record<string, any> = {};
  presentes.forEach(k => delObj[k] = deleteField());
  await updateDoc(docRef, delObj);
  return presentes.length;
}

// NUEVO: Suscribirse a colección raíz de proveedores
export const PROVIDERS_COLLECTION = 'proveedores';

// Agregar estos métodos después de limpiarConfigGlobal en la sección Collections
// (se insertarán después de la sección Collections)
// NUEVO: Suscribirse a colección raíz de proveedores
export const subscribeProviders = (callback: (data: any[]) => void, limitCount?: number) => {
  if (!db) return () => {};
  let ref: CollectionReference = collection(db, PROVIDERS_COLLECTION);
  if (limitCount) ref = query(ref, limit(limitCount));
  return onSnapshot(ref, (snapshot) => {
    const list: any[] = [];
    snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    callback(list);
  });
};

// NUEVO: Obtener todos los proveedores de la colección raíz
export const getAllProviders = async () => {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, PROVIDERS_COLLECTION));
  const list: any[] = [];
  snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
  return list;
};