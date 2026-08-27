"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShoppingBag, 
  Plus, 
  Trash2, 
  Search,
  CheckCircle,
  HandCoins,
  Calendar,
  Layers,
  ArrowRight,
  Info,
  X,
  Trash,
  Boxes
} from 'lucide-react';
import { Store, Utils, Collections, PROVIDERS_COLLECTION } from '@/lib/db-store';
import { AppState, Product, Movimiento, PaymentMethod, KitItem, Supplier, LibroDiarioEntry, Debt } from '@/lib/types';
import { toast } from '@/hooks/use-toast';
import { ProductFormModal } from '@/components/inventory/ProductFormModal';
import { actualizarStockProducto, unidadesAMl } from '@/lib/stock-utils';

interface PurchaseItemTemp {
  productoId: string;
  nombre: string;
  cantidad: number;
  costoUnitarioUSD: number;
  subtotalUSD: number;
}

interface PurchaseModuleProps {
  state: AppState;
  updateState: (newState: Partial<AppState>) => void;
}

export default function PurchaseModule({ state, updateState }: PurchaseModuleProps) {
  // Helper local para formatear con 4 decimales
  const fmt4 = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  // 1. DATOS DE LA FACTURA
  const [proveedor, setProveedor] = useState('');
  const [proveedorSearch, setProveedorSearch] = useState('');
  const [proveedorAbierto, setProveedorAbierto] = useState(false);
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fecha, setFecha] = useState(Utils.hoy());
  const [tasaCompra, setTasaCompra] = useState<string | number>(state.tasa || 1);
  
  // 2. CONDICIONES DE PAGO
  const [condicion, setCondicion] = useState<'contado' | 'credito' | 'mixto'>('contado');
  const [diasPlazo, setDiasPlazo] = useState<string | number>('30');
  const [montoPagadoUSD, setMontoPagadoUSD] = useState<string | number>('0');
  const [montoPagadoBS, setMontoPagadoBS] = useState<string | number>('0');

  // 3. AÑADIR PRODUCTOS
  const [busqueda, setBusqueda] = useState('');
  const [itemSeleccionado, setItemSeleccionado] = useState<Product | null>(null);
  const [cantidad, setCantidad] = useState<string | number>(1);
  const [costoInput, setCostoInput] = useState<string | number>(0);
  const [loteTemporal, setLoteTemporal] = useState<PurchaseItemTemp[]>([]);

  // Modal para nuevo producto
  const [showNewProductModal, setShowNewProductModal] = useState(false);

  // Normalización de proveedores para evitar errores de tipo (ahora desde state.proveedores que viene de la colección raíz)
  const safeProveedores = useMemo(() => {
    return (state.proveedores || []).map((p: any) => {
      if (typeof p === 'string') return { id: p, nombre: p, rif: '', contacto: '', direccion: '', telefono: '' };
      const nombre = p.nombre || p.name || p.supplierName || p.rif || 'PROVEEDOR SIN NOMBRE';
      return { ...p, id: p.id || nombre, nombre };
    });
  }, [state.proveedores]);

  // Búsqueda inteligente de proveedores por nombre o RIF
  const proveedoresFiltrados = useMemo(() => {
    const q = proveedorSearch.trim().toLowerCase();
    if (!q) return safeProveedores;
    return safeProveedores.filter(p =>
      (p.nombre || '').toLowerCase().includes(q) ||
      (p.rif || '').toLowerCase().includes(q)
    );
  }, [safeProveedores, proveedorSearch]);

  // Cálculos de Totales (Usando precisión de 4 decimales)
  const totalUSD = loteTemporal.reduce((acc, item) => acc + item.subtotalUSD, 0);
  const tasaActual = parseFloat(tasaCompra.toString()) || 1;

  // Sincronizar montos al cambiar condición
  useEffect(() => {
    if (condicion === 'contado') {
      setMontoPagadoUSD(totalUSD.toFixed(4));
      setMontoPagadoBS((totalUSD * tasaActual).toFixed(2));
    } else if (condicion === 'credito') {
      setMontoPagadoUSD('0');
      setMontoPagadoBS('0');
    }
  }, [condicion, totalUSD, tasaActual]);

  const pMontoPagadoUSD = parseFloat(montoPagadoUSD.toString()) || 0;
  const saldoPendienteUSD = Math.max(0, totalUSD - pMontoPagadoUSD);

  // Handlers para montos mixtos
  const handleMontoUSDChange = (val: string) => {
    if (!/^\d*\.?\d*$/.test(val)) return;
    setMontoPagadoUSD(val);
    const nUSD = parseFloat(val) || 0;
    setMontoPagadoBS((nUSD * tasaActual).toFixed(2));
  };

  const handleMontoBSChange = (val: string) => {
    if (!/^\d*\.?\d*$/.test(val)) return;
    setMontoPagadoBS(val);
    const nBS = parseFloat(val) || 0;
    setMontoPagadoUSD((nBS / tasaActual).toFixed(4));
  };

  // Buscador de productos
  const matches = useMemo(() => {
    if (busqueda.trim().length < 2) return [];
    return state.productos.filter(p => 
      p.activo && 
      (p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || p.codigo.toLowerCase().includes(busqueda.toLowerCase()))
    ).slice(0, 5);
  }, [busqueda, state.productos]);

  const handleSelectItem = (p: Product) => {
    setItemSeleccionado(p);
    setCostoInput(p.costoUSD || 0);
    setBusqueda('');
  };

  const handleAddTempItem = () => {
    const pCant = parseFloat(cantidad.toString()) || 0;
    const pCosto = parseFloat(costoInput.toString()) || 0;
    if (!itemSeleccionado || pCant <= 0 || pCosto <= 0) {
      toast({ 
        title: "Datos inválidos", 
        description: "Seleccione un producto y asegúrese de que la cantidad y el costo sean mayores a 0.",
        variant: "destructive"
      });
      return;
    }
    
    // Verificar si el producto ya está en la lista para evitar duplicados
    const existe = loteTemporal.some(item => item.productoId === itemSeleccionado.id);
    if (existe) {
      toast({ 
        title: "Producto duplicado", 
        description: "Este producto ya está en la lista. Si necesita agregar más cantidad, modifique la cantidad existente.",
        variant: "destructive"
      });
      return;
    }

    const nuevo: PurchaseItemTemp = {
      productoId: itemSeleccionado.id,
      nombre: itemSeleccionado.nombre,
      cantidad: pCant,
      costoUnitarioUSD: pCosto,
      subtotalUSD: Math.round((pCant * pCosto + Number.EPSILON) * 10000) / 10000
    };

    setLoteTemporal([...loteTemporal, nuevo]);
    setItemSeleccionado(null);
    setCantidad(1);
    setCostoInput(0);
    setBusqueda('');
    
    toast({ 
      title: "Producto agregado", 
      description: `${nuevo.nombre} - Cantidad: ${nuevo.cantidad}` 
    });
  };

  const handleRemoveTempItem = (idx: number) => {
    setLoteTemporal(loteTemporal.filter((_, i) => i !== idx));
  };

  const handleProcessPurchase = async () => {
    if (!proveedor) {
      toast({ title: "Proveedor requerido", description: "Seleccione un proveedor", variant: "destructive" });
      return;
    }
    if (!numeroFactura) {
      toast({ title: "Número de factura requerido", description: "Ingrese el número de factura", variant: "destructive" });
      return;
    }
    if (loteTemporal.length === 0) {
      toast({ title: "Lote vacío", description: "Agregue productos a la lista", variant: "destructive" });
      return;
    }

    const ahoraStr = Utils.ahora();
    const pDias = parseInt(diasPlazo.toString()) || 0;
    const fechaVencimiento = condicion !== 'contado' ? 
      new Date(new Date(fecha).getTime() + (pDias * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10) : 
      fecha;

    const nuevosProductos = state.productos.map(p => {
      const itemCompra = loteTemporal.find(i => i.productoId === p.id);
      if (itemCompra) {
        const stockActual = p.stock || 0;
        const costoActual = p.costoUSD || 0;
        const nuevaCantidad = itemCompra.cantidad;
        const nuevoCosto = itemCompra.costoUnitarioUSD;
        const stockMLPrev = p.stockML ?? (p.stock || 0) * (p.volumenPorUnidad || 1);
        
        const stockTotal = stockActual + nuevaCantidad;
        // Costo Promedio Ponderado con 4 decimales
        const costoPromedio = stockTotal > 0 ? 
          Math.round((((stockActual * costoActual) + (nuevaCantidad * nuevoCosto)) / stockTotal + Number.EPSILON) * 10000) / 10000 : 
          nuevoCosto;

        // Mantener stockML al día (base del stock virtual de licores fraccionados).
        return { ...p, stock: stockTotal, costoUSD: costoPromedio, stockML: stockMLPrev + unidadesAMl(p, nuevaCantidad) };
      }
      return p;
    });

    // 🔑 Recalcular en tiempo real los kits virtuales que usan productos del lote como componentes.
    let productosConKits = [...nuevosProductos];
    for (const item of loteTemporal) {
      productosConKits = actualizarStockProducto(productosConKits, item.productoId, 0, 0);
    }

    const nuevosMovimientos: Movimiento[] = loteTemporal.map(item => {
      const p = state.productos.find(prod => prod.id === item.productoId);
      return {
        id: Store.uid(),
        productoId: item.productoId,
        tipo: 'compra',
        cantidad: item.cantidad,
        stockAntes: p?.stock || 0,
        stockDespues: (p?.stock || 0) + item.cantidad,
        fecha: ahoraStr,
        referencia: `COMPRA FACT: ${numeroFactura} - PROV: ${proveedor}`,
        terminalId: 'ADMIN'
      };
    });

    // ASIENTO CONTABLE: Solo el monto real pagado hoy
    let nuevosAsientosDiario: LibroDiarioEntry[] = [];
    if (pMontoPagadoUSD > 0.0001) {
      nuevosAsientosDiario.push({
        id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
        fecha: ahoraStr,
        tipo: 'egreso',
        categoria: 'COMPRA',
        concepto: `COMPRA MERCANCIA FACT #${numeroFactura} - PROV: ${proveedor.toUpperCase()}`,
        montoUSD: pMontoPagadoUSD,
        montoBS: pMontoPagadoUSD * tasaActual,
        metodo: 'efectivo_usd',
        referencia: numeroFactura
      });
    }

    const nuevasCxP = [...state.cxp];
    if (saldoPendienteUSD > 0.0001) {
      // Registrar abono inicial si existe en el historial de la deuda
      const initialHistory = pMontoPagadoUSD > 0.0001 ? [{
        fecha: ahoraStr,
        montoUSD: pMontoPagadoUSD,
        montoBS: pMontoPagadoUSD * tasaActual,
        metodo: 'efectivo_usd',
        reciboId: 'INICIAL-CONTADO'
      }] : [];

      const nuevaDeuda: Debt = {
        id: 'CXP-' + Store.uid().slice(0, 6).toUpperCase(),
        fecha: fecha,
        fechaVencimiento: fechaVencimiento,
        proveedor: proveedor,
        concepto: `FACTURA COMPRA #${numeroFactura}`,
        montoUSD: totalUSD,
        abonadoUSD: pMontoPagadoUSD,
        saldoUSD: saldoPendienteUSD,
        estado: pMontoPagadoUSD > 0.0001 ? 'parcial' : 'pendiente',
        items: [...loteTemporal],
        numeroFactura: numeroFactura,
        historialPagos: initialHistory
      };
      nuevasCxP.push(nuevaDeuda);
    }

    // 🔑 PERSISTIR EN COLECCIONES RAÍZ (ya NO se guarda en config/global)
    try {
      // 1. Productos actualizados (stock + costo)
      for (const p of productosConKits) {
        const comprado = loteTemporal.some(i => i.productoId === p.id);
        if (comprado) await Collections.set('productos', p.id, p);
      }
      // 2. Movimientos de kardex
      for (const mov of nuevosMovimientos) {
        await Collections.set('movimientos', mov.id, mov);
      }
      // 3. Asientos contables
      for (const asiento of nuevosAsientosDiario) {
        await Collections.set('libroDiario', asiento.id, asiento);
      }
      // 4. Cuentas por pagar (si hay saldo pendiente)
      if (saldoPendienteUSD > 0.0001) {
        const nuevaDeuda = nuevasCxP[nuevasCxP.length - 1];
        await Collections.set('cxp', nuevaDeuda.id, nuevaDeuda);
      }
      // 5. Registro de la compra (¡IMPORTANTE: último para confirmar todo!)
      const compraId = 'COMP-' + Store.uid().slice(0, 8).toUpperCase();
      await Collections.set('compras', compraId, {
        id: compraId,
        numeroFactura,
        proveedor,
        fecha,
        fechaVencimiento,
        condicion,
        items: loteTemporal,
        totalUSD,
        pagadoUSD: pMontoPagadoUSD,
        saldoUSD: saldoPendienteUSD,
        tasa: tasaActual,
        terminalId: 'ADMIN',
        createdAt: ahoraStr
      });

      // ✅ SOLO si TODAS las escrituras succeeded: actualizar estado local y limpiar form
      updateState({
        productos: productosConKits,
        movimientos: [...state.movimientos, ...nuevosMovimientos],
        libroDiario: [...nuevosAsientosDiario, ...(state.libroDiario || [])],
        cxp: nuevasCxP
      });

      toast({ 
        title: "Compra Registrada ✅", 
        description: `Factura ${numeroFactura} guardada en Firestore.` 
      });
      
      setProveedor('');
      setProveedorSearch('');
      setProveedorAbierto(false);
      setNumeroFactura('');
      setLoteTemporal([]);
      setCondicion('contado');
      setMontoPagadoUSD('0');
      setMontoPagadoBS('0');

    } catch (err: any) {
      console.error('❌ Error guardando compra:', err);
      toast({ 
        title: "Error al guardar compra", 
        description: err?.message || 'No se pudo persistir en Firestore. Verifique conexión y permisos.',
        variant: "destructive",
        duration: 8000
      });
      // NO limpiar formulario: usuario puede reintentar
    }
  };

  // Handler para guardar producto desde el modal
  const handleSaveProduct = async (productData: any) => {
    const newProduct = {
      id: Store.uid(),
      ...productData,
      activo: true,
      createdAt: Utils.ahora(),
      updatedAt: Utils.ahora()
    };
    // 🔑 Persistir en colección raíz (ya NO en config/global)
    await Collections.set('productos', newProduct.id, newProduct);
    updateState({
      productos: [...state.productos, newProduct]
    });
    setShowNewProductModal(false);
    toast({ title: "Producto creado", description: `${newProduct.nombre} ha sido agregado al inventario.` });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl flex items-center gap-2">
            <ShoppingBag className="text-brand-gold" /> REGISTRO DE ENTRADAS POR COMPRA
          </h2>
          <p className="text-[10px] text-ink font-bold uppercase tracking-widest opacity-60">Control de Abastecimiento y Costos CPP</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLUMNA IZQUIERDA */}
        <div className="space-y-6">
          <div className="card shadow-lg border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4">
              <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Info className="w-5 h-5 text-brand-gold" /> DATOS DE LA FACTURA
              </h3>
            </div>
            <div className="card-body p-6 space-y-4">
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Proveedor</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink opacity-30 pointer-events-none" />
                  <input
                    className="form-input pl-10 h-11 text-sm font-black text-ink w-full"
                    placeholder="Buscar proveedor..."
                    value={proveedorSearch}
                    onChange={e => { setProveedorSearch(e.target.value); setProveedor(''); setProveedorAbierto(true); }}
                    onFocus={() => setProveedorAbierto(true)}
                    onBlur={() => setTimeout(() => setProveedorAbierto(false), 150)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && proveedoresFiltrados.length === 1) {
                        const p = proveedoresFiltrados[0];
                        setProveedor(p.nombre); setProveedorSearch(p.nombre); setProveedorAbierto(false);
                      }
                    }}
                  />
                  {proveedorAbierto && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-line rounded-lg shadow-2xl max-h-[220px] overflow-y-auto">
                      {proveedoresFiltrados.length === 0 ? (
                        <div className="p-4 text-center text-ink font-black uppercase italic text-[10px]">
                          {proveedorSearch.trim() ? 'Sin proveedores coincidentes' : 'No hay proveedores registrados'}
                        </div>
                      ) : proveedoresFiltrados.map(p => (
                        <button
                          key={p.id}
                          onMouseDown={(e) => { e.preventDefault(); setProveedor(p.nombre); setProveedorSearch(p.nombre); setProveedorAbierto(false); }}
                          className={`w-full text-left px-4 py-3 text-xs font-black uppercase border-b border-line/20 last:border-0 hover:bg-brand-gold/10 transition-colors ${proveedor === p.nombre ? 'bg-brand-gold/10 text-brand-gold-deep border-l-4 border-brand-gold' : 'text-ink'}`}
                        >
                          {p.nombre}
                          <span className="block text-[9px] font-bold opacity-50">{p.rif || 'Sin RIF'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {proveedor && (
                  <p className="mt-1 text-[9px] font-black uppercase text-brand-gold-deep">Proveedor: {proveedor}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">N° Factura</label>
                  <input className="form-input h-11 text-sm font-black" value={numeroFactura} onChange={e => setNumeroFactura(e.target.value)} placeholder="000123" />
                </div>
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Tasa Aplicada</label>
                  <input type="number" step="0.01" className="form-input h-11 text-brand-gold-deep font-black" value={tasaCompra} onChange={e => setTasaCompra(e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Fecha Factura</label>
                <input type="date" className="form-input h-11 text-sm font-black" value={fecha} onChange={e => setFecha(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="card shadow-lg border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-surface-soft border-b border-line px-6 py-3 flex justify-center gap-2">
                {['contado', 'credito', 'mixto'].map(c => (
                  <button 
                    key={c} 
                    onClick={() => setCondicion(c as any)} 
                    className={`px-6 h-9 rounded-full text-[10px] font-black uppercase transition-all shadow-sm ${condicion === c ? 'bg-brand-gold text-white' : 'bg-white text-ink border border-line hover:bg-surface-warm'}`}
                  >
                    {c}
                  </button>
                ))}
            </div>
            <div className="card-body p-6 space-y-5">
              
              {condicion !== 'contado' && (
                <div className="form-group animate-in slide-in-from-top-2">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Días de Crédito</label>
                  <input 
                    type="number" 
                    className="form-input h-10 text-center font-black" 
                    value={diasPlazo} 
                    onChange={e => setDiasPlazo(e.target.value)} 
                  />
                </div>
              )}

              {condicion === 'mixto' && (
                <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-2">
                   <div className="form-group">
                      <label className="text-ink text-[9px] font-black uppercase block mb-1">Pagado ($)</label>
                      <input 
                        className="form-input h-10 text-sm font-black text-status-success" 
                        value={montoPagadoUSD} 
                        onChange={e => handleMontoUSDChange(e.target.value)} 
                      />
                   </div>
                   <div className="form-group">
                      <label className="text-ink text-[9px] font-black uppercase block mb-1">Pagado (Bs)</label>
                      <input 
                        className="form-input h-10 text-sm font-black text-ink" 
                        value={montoPagadoBS} 
                        onChange={e => handleMontoBSChange(e.target.value)} 
                      />
                   </div>
                </div>
              )}

              <div className="space-y-3 pt-2 border-t border-line/50">
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-40">TOTAL FACTURA:</span>
                  <span className="text-ink text-base">{fmt4(totalUSD)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase">
                  <span className="text-ink opacity-40">PAGADO HOY:</span>
                  <span className="text-status-success text-base">{fmt4(pMontoPagadoUSD)}</span>
                </div>
                <div className="flex justify-between items-center text-[10px] font-black uppercase border-t border-line/50 pt-3">
                  <span className="text-ink opacity-40">SALDO PENDIENTE:</span>
                  <span className="text-status-danger text-lg">{fmt4(saldoPendienteUSD)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* COLUMNA DERECHA */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card shadow-lg border-line rounded-xl overflow-hidden bg-white">
            <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                   <button onClick={() => setShowNewProductModal(true)} className="p-1 hover:bg-white/10 rounded transition-colors">
                     <Plus className="w-5 h-5 text-brand-gold" />
                   </button>
                   <h3 className="text-white font-black text-xs uppercase italic tracking-tighter">ADICIÓN DE ÍTEMS AL LOTE</h3>
                </div>
            </div>
            <div className="card-body p-6">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                <div className="md:col-span-6 relative">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Buscar Producto Existente</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-3 w-4 h-4 text-brand-gold" />
                    <input className="form-input pl-10 h-11 bg-surface-soft border-line" placeholder="Nombre o Código..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                  </div>
                  {matches.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-line rounded shadow-2xl z-[100] mt-1 overflow-hidden max-h-[200px] overflow-y-auto">
                      {matches.map(p => (
                        <div key={p.id} onClick={() => handleSelectItem(p)} className="p-3 border-b border-line hover:bg-brand-gold/10 cursor-pointer flex justify-between items-center transition-colors">
                          <div className="flex flex-col"><span className="text-xs font-black text-ink uppercase">{p.nombre}</span><span className="text-[9px] text-ink/40 mono">{p.codigo}</span></div>
                          <div className="text-brand-gold-deep font-black text-xs">${(p.costoUSD || 0).toFixed(4)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2 text-center">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Cant.</label>
                  <input type="number" className="form-input h-11 text-center font-black bg-surface-soft border-line" value={cantidad} onChange={e => setCantidad(e.target.value)} />
                </div>
                <div className="md:col-span-2 text-center">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Costo $</label>
                  <input type="number" step="0.0001" className="form-input h-11 text-center font-black bg-surface-soft border-line text-brand-gold-deep" value={costoInput} onChange={e => setCostoInput(e.target.value)} />
                </div>
                <div className="md:col-span-2">
                  <button onClick={handleAddTempItem} disabled={!itemSeleccionado} className="btn btn-primary w-full h-11 shadow-md disabled:opacity-20 flex items-center justify-center"><Plus className="w-5 h-5"/></button>
                </div>
              </div>
              {itemSeleccionado && (
                <div className="mt-3 p-3 bg-brand-gold-soft/20 border border-brand-gold/20 rounded-lg">
                  <p className="text-xs font-black text-brand-gold-deep">Producto seleccionado: {itemSeleccionado.nombre} (Stock actual: {itemSeleccionado.stock || 0} und)</p>
                </div>
              )}
            </div>

            <div className="table-wrap border-t border-line max-h-[300px] overflow-y-auto">
              <table className="bg-white">
                <thead className="bg-surface-soft sticky top-0 z-10">
                  <tr>
                    <th className="font-black text-ink uppercase text-[10px] py-4 px-6">Producto</th>
                    <th className="font-black text-ink uppercase text-[10px] text-center">Cant</th>
                    <th className="font-black text-ink uppercase text-[10px] text-right">Costo Unit.</th>
                    <th className="font-black text-ink uppercase text-[10px] text-right">Subtotal</th>
                    <th className="font-black text-ink uppercase text-[10px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {loteTemporal.map((item, idx) => (
                    <tr key={idx} className="border-b border-line/30 hover:bg-surface-warm/20">
                      <td className="text-xs font-black text-ink uppercase py-4 px-6">{item.nombre}</td>
                      <td className="text-center font-bold text-ink">{item.cantidad}</td>
                      <td className="text-right font-bold text-ink">{fmt4(item.costoUnitarioUSD)}</td>
                      <td className="text-right font-black text-brand-gold-deep">{fmt4(item.subtotalUSD)}</td>
                      <td className="text-center">
                        <button onClick={() => handleRemoveTempItem(idx)} className="text-ink/20 hover:text-status-danger transition-colors p-2"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                  {loteTemporal.length === 0 && (
                    <tr><td colSpan={5} className="py-20 text-center text-ink/20 font-black uppercase italic opacity-40">Añada productos al lote de compra para procesar</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="card-foot p-6 bg-surface-soft flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="flex flex-wrap gap-4">
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Total Factura</span>
                   <p className="text-lg font-black text-ink leading-none">{fmt4(totalUSD)}</p>
                </div>
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Equiv. BS</span>
                   <p className="text-lg font-black text-ink leading-none">{Utils.fmtBS(totalUSD * tasaActual)}</p>
                </div>
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Total Pagado USD</span>
                   <p className="text-lg font-black text-ink leading-none">{fmt4(pMontoPagadoUSD)}</p>
                </div>
                <div className="bg-white p-3 px-6 rounded-xl border border-line text-center shadow-sm">
                   <span className="text-[9px] font-black uppercase opacity-40 block mb-0.5">Total Pendiente</span>
                   <p className="text-lg font-black text-ink leading-none">{fmt4(saldoPendienteUSD)}</p>
                </div>
              </div>
              <button onClick={handleProcessPurchase} disabled={loteTemporal.length === 0} className="btn btn-primary h-14 px-10 font-black uppercase text-xs shadow-xl disabled:opacity-20 transition-all flex items-center gap-3">
                Procesar e Importar Inventario <CheckCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Producto - CORREGIDO */}
      {showNewProductModal && (
        <ProductFormModal 
          state={state}
          onClose={() => setShowNewProductModal(false)}
          onSave={handleSaveProduct}
          onUpdateLists={(lists: any) => {
            updateState(lists);
          }}
          producto={undefined}
        />
      )}
    </div>
  );
}