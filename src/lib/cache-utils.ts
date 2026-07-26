// lib/cache-utils.ts

const CACHE_KEY = 'posven_productos_cache';
const CACHE_TIMESTAMP_KEY = 'posven_productos_timestamp';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Guarda productos en caché
 */
export const cacheProductos = (productos: any[]) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CACHE_KEY, JSON.stringify(productos));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    }
  } catch (error) {
    console.warn('Error al guardar caché de productos:', error);
  }
};

/**
 * Obtiene productos desde caché (si no está expirado)
 */
export const getProductosFromCache = (): any[] | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!timestamp) return null;
    
    const age = Date.now() - parseInt(timestamp);
    if (age > CACHE_TTL) return null; // Expirado
    
    const data = localStorage.getItem(CACHE_KEY);
    if (!data) return null;
    
    return JSON.parse(data);
  } catch (error) {
    console.warn('Error al leer caché de productos:', error);
    return null;
  }
};

/**
 * Limpia la caché de productos
 */
export const clearProductosCache = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    }
  } catch (error) {
    console.warn('Error al limpiar caché de productos:', error);
  }
};