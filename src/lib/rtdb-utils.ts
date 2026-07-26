import { rtdb } from './firebase';
import { 
  ref, 
  get, 
  set, 
  update, 
  remove, 
  increment, 
  onValue,
  off,
  query,
  orderByChild,
  equalTo,
  limitToFirst,
  push,
  child
} from 'firebase/database';

// ============================================================
// FUNCIONES DE STOCK
// ============================================================

/**
 * Obtiene el stock de un producto desde RTDB
 * @param productoId ID del producto
 * @returns stock actual o 0 si no existe
 */
export const getStockRTDB = async (productoId: string): Promise<number> => {
  try {
    const snapshot = await get(ref(rtdb, `/stock/${productoId}`));
    return snapshot.val() || 0;
  } catch (error) {
    console.error('Error al leer stock RTDB:', error);
    return 0;
  }
};

/**
 * Actualiza el stock de múltiples productos en RTDB
 * @param items Array de {productoId, cantidad} (cantidad negativa = disminuir)
 */
export const updateStockRTDB = async (items: { productoId: string, cantidad: number }[]) => {
  try {
    const updates: Record<string, any> = {};
    items.forEach(item => {
      if (item.cantidad !== 0) {
        updates[`/stock/${item.productoId}`] = increment(-item.cantidad);
      }
    });
    await update(ref(rtdb), updates);
  } catch (error) {
    console.error('Error al actualizar stock RTDB:', error);
    throw error;
  }
};

/**
 * Restaura stock (para devoluciones o anulaciones)
 */
export const restoreStockRTDB = async (items: { productoId: string, cantidad: number }[]) => {
  try {
    const updates: Record<string, any> = {};
    items.forEach(item => {
      if (item.cantidad !== 0) {
        updates[`/stock/${item.productoId}`] = increment(item.cantidad);
      }
    });
    await update(ref(rtdb), updates);
  } catch (error) {
    console.error('Error al restaurar stock RTDB:', error);
    throw error;
  }
};

/**
 * Inicializa stock de un producto nuevo
 */
export const initStockRTDB = async (productoId: string, stockInicial: number = 0) => {
  try {
    await set(ref(rtdb, `/stock/${productoId}`), stockInicial);
  } catch (error) {
    console.error('Error al inicializar stock RTDB:', error);
    throw error;
  }
};

// ============================================================
// FUNCIONES DE CONTADORES DE TERMINAL
// ============================================================

/**
 * Obtiene el próximo número de recibo desde RTDB
 */
export const getProximoReciboRTDB = async (terminalId: string): Promise<number> => {
  try {
    const snapshot = await get(ref(rtdb, `/terminales/${terminalId}/proximoRecibo`));
    return snapshot.val() || 1;
  } catch (error) {
    console.error('Error al leer próximo recibo RTDB:', error);
    return 1;
  }
};

/**
 * Incrementa el contador de recibo en RTDB
 */
export const incrementarReciboRTDB = async (terminalId: string) => {
  try {
    await update(ref(rtdb), {
      [`/terminales/${terminalId}/proximoRecibo`]: increment(1)
    });
  } catch (error) {
    console.error('Error al incrementar recibo RTDB:', error);
    throw error;
  }
};

/**
 * Incrementa el contador de ventas de efectivo en RTDB
 */
export const incrementarVentaEfectivoRTDB = async (terminalId: string) => {
  try {
    await update(ref(rtdb), {
      [`/terminales/${terminalId}/proximaVentaEfectivo`]: increment(1)
    });
  } catch (error) {
    console.error('Error al incrementar venta efectivo RTDB:', error);
    throw error;
  }
};

// ============================================================
// FUNCIONES DE CAJA (Fondo)
// ============================================================

/**
 * Obtiene el fondo de caja desde RTDB
 */
export const getFondoCajaRTDB = async (terminalId: string): Promise<{ usd: number, bs: number }> => {
  try {
    const snapshot = await get(ref(rtdb, `/terminales/${terminalId}/fondoCaja`));
    const data = snapshot.val() || { usd: 0, bs: 0 };
    return { usd: data.usd || 0, bs: data.bs || 0 };
  } catch (error) {
    console.error('Error al leer fondo caja RTDB:', error);
    return { usd: 0, bs: 0 };
  }
};

/**
 * Actualiza el fondo de caja en RTDB
 */
export const setFondoCajaRTDB = async (terminalId: string, usd: number, bs: number) => {
  try {
    await set(ref(rtdb, `/terminales/${terminalId}/fondoCaja`), { usd, bs });
  } catch (error) {
    console.error('Error al actualizar fondo caja RTDB:', error);
    throw error;
  }
};

// ============================================================
// FUNCIONES DE ESCUCHA EN TIEMPO REAL
// ============================================================

/**
 * Escucha cambios de stock de un producto en tiempo real
 * @returns Función para cancelar la suscripción
 */
export const listenStockRTDB = (
  productoId: string, 
  callback: (stock: number) => void
): (() => void) => {
  const stockRef = ref(rtdb, `/stock/${productoId}`);
  
  const unsubscribe = onValue(stockRef, (snapshot) => {
    callback(snapshot.val() || 0);
  }, (error) => {
    console.error('Error al escuchar stock RTDB:', error);
  });
  
  return unsubscribe;
};

/**
 * Escucha cambios de múltiples stocks
 */
export const listenMultipleStocksRTDB = (
  productoIds: string[],
  callback: (stocks: Record<string, number>) => void
): (() => void) => {
  const stocks: Record<string, number> = {};
  const unsubscribes: (() => void)[] = [];
  
  productoIds.forEach(id => {
    const unsub = listenStockRTDB(id, (stock) => {
      stocks[id] = stock;
      callback({ ...stocks });
    });
    unsubscribes.push(unsub);
  });
  
  return () => {
    unsubscribes.forEach(unsub => unsub());
  };
};

// ============================================================
// FUNCIÓN DE LIMPIEZA (para formateo)
// ============================================================

/**
 * Elimina todos los datos de RTDB (usar con precaución)
 */
export const clearRTDB = async () => {
  try {
    await remove(ref(rtdb));
  } catch (error) {
    console.error('Error al limpiar RTDB:', error);
    throw error;
  }
};

// ============================================================
// FUNCIÓN DE INICIALIZACIÓN
// ============================================================

/**
 * Inicializa la estructura base en RTDB
 */
export const initRTDBStructure = async (terminalId: string) => {
  try {
    // Inicializar contador de recibo
    await set(ref(rtdb, `/terminales/${terminalId}/proximoRecibo`), 1);
    
    // Inicializar fondo de caja
    await set(ref(rtdb, `/terminales/${terminalId}/fondoCaja`), { usd: 0, bs: 0 });
    
    // Inicializar contador de ventas de efectivo
    await set(ref(rtdb, `/terminales/${terminalId}/proximaVentaEfectivo`), 1);
    
    console.log(`✅ RTDB inicializada para terminal: ${terminalId}`);
  } catch (error) {
    console.error('Error al inicializar RTDB:', error);
    throw error;
  }
};