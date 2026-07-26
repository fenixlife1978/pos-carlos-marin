// lib/offline-queue.ts

const QUEUE_KEY = 'posven_pending_sales';

interface PendingSale {
  id: string;
  data: any;
  timestamp: string;
  attempts: number;
}

/**
 * Agrega una venta a la cola offline
 */
export const addToQueue = (saleData: any): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    
    const current = getQueue();
    const newSale: PendingSale = {
      id: `offline_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      data: saleData,
      timestamp: new Date().toISOString(),
      attempts: 0
    };
    
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...current, newSale]));
    console.log('📦 Venta agregada a cola offline');
  } catch (error) {
    console.warn('Error al agregar a cola offline:', error);
  }
};

/**
 * Obtiene la cola de ventas pendientes
 */
export const getQueue = (): PendingSale[] => {
  try {
    if (typeof localStorage === 'undefined') return [];
    const data = localStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.warn('Error al leer cola offline:', error);
    return [];
  }
};

/**
 * Elimina una venta de la cola
 */
export const removeFromQueue = (id: string): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    const current = getQueue();
    localStorage.setItem(QUEUE_KEY, JSON.stringify(current.filter(s => s.id !== id)));
  } catch (error) {
    console.warn('Error al eliminar de cola offline:', error);
  }
};

/**
 * Procesa la cola de ventas pendientes (sincronización)
 */
export const processQueue = async (processFn: (data: any) => Promise<void>): Promise<number> => {
  const queue = getQueue();
  if (queue.length === 0) return 0;
  
  let processed = 0;
  let failed = 0;
  
  for (const item of queue) {
    try {
      await processFn(item.data);
      removeFromQueue(item.id);
      processed++;
      console.log(`✅ Venta offline #${item.id} sincronizada`);
    } catch (error) {
      console.warn(`❌ Error al sincronizar venta #${item.id}:`, error);
      failed++;
      
      // Incrementar intentos
      const updated = { ...item, attempts: item.attempts + 1 };
      const current = getQueue();
      const idx = current.findIndex(s => s.id === item.id);
      if (idx > -1) {
        current[idx] = updated;
        localStorage.setItem(QUEUE_KEY, JSON.stringify(current));
      }
    }
  }
  
  console.log(`📊 Cola offline: ${processed} procesadas, ${failed} fallidas, ${getQueue().length} pendientes`);
  return processed;
};