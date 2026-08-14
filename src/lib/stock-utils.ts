import { Product } from './types';

/**
 * Cantidad de mililitros (ml) por unidad de stock según la unidad del producto.
 * - 'ml'      → 1
 * - 'litros'  → 1000
 * - else      → volumenPorUnidad (default 1)
 */
export const mlPorUnidad = (p: Product): number => {
  if (p.unidadStock === 'ml') return 1;
  if (p.unidadStock === 'litros') return 1000;
  return (p.volumenPorUnidad && p.volumenPorUnidad > 0) ? p.volumenPorUnidad : 1;
};

/**
 * Convierte una cantidad (en unidades de stock del producto) a mililitros.
 */
export const unidadesAMl = (p: Product, cantidad: number): number =>
  (cantidad || 0) * mlPorUnidad(p);

/**
 * Recalcula el stockML de un producto a partir de su stock en unidades
 * (misma regla que usa ProductFormModal al guardar la ficha).
 */
export const stockMLDesdeStock = (p: Product): number =>
  (p.stock || 0) * mlPorUnidad(p);

/**
 * Aplica un delta de stock (en unidades del producto) y mantiene stockML al día.
 * Devuelve un nuevo objeto Product sin mutar el original.
 *
 * Si el delta se expresa en mililitros (ej: ajustes de 13000 ml), pásalo en
 * `deltaML` y el campo `stock` se ajustará sumando su equivalente en unidades.
 */
export const aplicarDeltaStock = (
  p: Product,
  deltaUnidades: number,
  deltaML?: number
): Product => {
  const unidades = deltaUnidades || 0;
  const ml = deltaML !== undefined ? deltaML : unidadesAMl(p, unidades);
  const stockBase = p.stockML ?? stockMLDesdeStock(p);
  return {
    ...p,
    stock: (p.stock || 0) + unidades,
    stockML: Math.max(0, stockBase + ml),
  };
};

/**
 * Stock en mililitros disponible de un producto. Para kits virtuales
 * (stock_componentes) SIEMPRE se deriva del stock real en unidades del
 * componente principal (stock * mlPorUnidad). Si el componente no tiene
 * stock real, se usa como respaldo su propio stockML. Nunca se usa el
 * stockML propio del kit (puede quedar desactualizado).
 *
 * La fuente de verdad es `cp.stock`: es el campo que se actualiza en todas
 * las operaciones (ventas, ajustes, compras, devoluciones). Por eso se
 * prioriza derivar de él en lugar de confiar en un stockML que podría estar
 * desincronizado.
 */
export const stockMLDisponible = (p: Product, todos: Product[]): number => {
  // Para un kit virtual: derivar SIEMPRE del stock real del componente.
  if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems && p.kitItems.length > 0) {
    for (const ki of p.kitItems) {
      const cp = todos.find(c => c.id === ki.productoId);
      if (!cp) continue;
      const desdeStock = stockMLDesdeStock(cp); // (cp.stock || 0) * mlPorUnidad(cp)
      if (desdeStock > 0) return desdeStock;
      if (cp.stockML !== undefined && cp.stockML > 0) return cp.stockML;
    }
    return 0;
  }
  // Producto normal: priorizar stock real convertido, respaldo stockML.
  const desdeStock = stockMLDesdeStock(p);
  if (desdeStock > 0) return desdeStock;
  return p.stockML !== undefined ? p.stockML : 0;
};

/**
 * Devuelve el array de productos con el stock/stockML del producto `productoId`
 * actualizado y con TODOS los kits virtuales (fraccionados) que lo usan como
 * componente recalculados en tiempo real.
 */
export const actualizarStockProducto = (
  productos: Product[],
  productoId: string,
  deltaUnidades: number,
  deltaML?: number
): Product[] => {
  const idx = productos.findIndex(p => p.id === productoId);
  if (idx < 0) return productos;

  const target = aplicarDeltaStock(productos[idx], deltaUnidades, deltaML);
  const nuevos = [...productos];
  nuevos[idx] = target;

  // Recalcular stockML de cualquier kit virtual que use este producto como componente.
  const actualizados = nuevos.map(p => {
    if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems && p.kitItems.length > 0) {
      const usa = p.kitItems.some(ki => ki.productoId === productoId);
      if (usa) return { ...p, stockML: stockMLDisponible(p, nuevos) };
    }
    return p;
  });

  return actualizados;
};

/**
 * Stock en mililitros EFECTIVO para mostrar en UI. Para kits virtuales
 * (fraccionados) devuelve el stock derivado del componente; para el resto usa
 * su propio stockML (o el derivado de stock). Garantiza tiempo real sin
 * depender de campos propios que puedan quedar desactualizados.
 */
export const stockMLVisible = (p: Product, todos: Product[]): number =>
  stockMLDisponible(p, todos);