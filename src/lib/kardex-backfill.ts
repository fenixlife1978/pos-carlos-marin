"use client";

import { Store, Utils, Collections } from './db-store';

// ============================================================
// BACKFILL DE KARDEX: Stock Inicial por producto
// ============================================================
// Asegura que TODO producto con stock > 0 tenga su movimiento de
// "STOCK INICIAL" (tipo 'inicial') en la colección raíz 'movimientos',
// para que el kardex muestre el recorrido completo desde el inicio.
// Es idempotente: solo crea movimientos que no existen.
export const asegurarStockInicial = async (): Promise<number> => {
  const [productos, movimientos] = await Promise.all([
    Collections.getAll('productos'),
    Collections.getAll('movimientos')
  ]);

  const movsPorProducto = new Map<string, any[]>();
  for (const m of movimientos) {
    if (!movsPorProducto.has(m.productoId)) movsPorProducto.set(m.productoId, []);
    movsPorProducto.get(m.productoId)!.push(m);
  }

  let creados = 0;
  for (const p of productos) {
    const movs = movsPorProducto.get(p.id) || [];
    const tieneInicial = movs.some(
      m => m.tipo === 'inicial' || (m.referencia || '').toUpperCase().startsWith('INICIAL')
    );
    const stockActual = Number(p.stock) || 0;
    if (!tieneInicial && stockActual > 0) {
      const mov = {
        id: Store.uid(),
        productoId: p.id,
        tipo: 'inicial' as const,
        cantidad: stockActual,
        stockAntes: 0,
        stockDespues: stockActual,
        fecha: p.fechaCreacion || p.createdAt || Utils.ahora(),
        referencia: 'INICIAL',
        terminalId: 'SISTEMA'
      };
      await Collections.set('movimientos', mov.id, mov);
      creados++;
    }
  }
  return creados;
};
