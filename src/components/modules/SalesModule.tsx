"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Search, 
  ShoppingCart, 
  Trash2, 
  Plus, 
  Receipt, 
  Barcode, 
  Wallet, 
  X, 
  CheckCircle2, 
  FileText,
  History,
  ClipboardList,
  ArrowLeft,
  Eye,
  Clock,
  Printer,
  Zap,
  Share2,
  UserPlus,
  User,
  AlertTriangle,
  Undo2,
  Lock,
  RefreshCw,
  Check,
  RotateCcw,
  HandCoins,
  Calculator,
  TrendingUp,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Contact,
  Maximize2,
  Minimize2,
  Tag,
  Loader2,
  Hash,
  Banknote,
  FlaskConical
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import { ReceiptModal } from '@/components/pos/ReceiptModal';
import { CreditModal } from '@/components/pos/CreditModal';
import { CashSaleModal } from '@/components/pos/CashSaleModal';
import FloatingPaymentModal from '@/components/pos/FloatingPaymentModal';
import { toast } from '@/hooks/use-toast';
import { AppState, SaleItem, Sale, PaymentMethod, ReportZ, PagoRealizado, Customer, Return, ReturnItem, Product, Debt, Movimiento, LibroDiarioEntry } from '@/lib/types';
import { Utils, Store, Collections } from '@/lib/db-store';
import ReturnsModule from '@/components/modules/ReturnsModule';
import { cn } from '@/lib/utils';

// ============================================================
// UTILIDADES DE NORMALIZACIÓN DE CÉDULA (integradas)
// ============================================================

function normalizeCedula(cedula: string, docType?: string): string {
  if (!cedula) return '';
  
  let type = docType || '';
  let number = cedula;
  
  const match = cedula.match(/^([A-Z]-?)?(.*)/);
  if (match) {
    if (match[1] && !docType) {
      type = match[1].replace('-', '').trim() + '-';
    }
    number = match[2] || '';
  }
  
  const cleanNumber = number.replace(/[^0-9]/g, '');
  
  if (!type) type = 'V-';
  
  if (type === 'V-' || type === 'E-') {
    const digits = cleanNumber;
    if (digits.length <= 2) return `${type}${digits}`;
    if (digits.length <= 5) return `${type}${digits.slice(0, 2)}.${digits.slice(2)}`;
    if (digits.length <= 8) return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
    return `${type}${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}`;
  }
  
  return `${type}${cleanNumber}`;
}

function getRawCedula(cedula: string): string {
  return cedula.replace(/[^0-9]/g, '');
}

function findCustomerByCedula(customers: any[], cedula: string): any | null {
  const raw = getRawCedula(cedula);
  return customers.find(c => getRawCedula(c.cedula) === raw) || null;
}

function findDebtsByCedula(deudas: any[], cedula: string): any[] {
  const raw = getRawCedula(cedula);
  return deudas.filter(d => {
    if (!d.cliente) return false;
    const match = d.cliente.match(/^(.*?)\s*\[(.*?)\]$/);
    if (match) {
      return getRawCedula(match[2]) === raw;
    }
    return false;
  });
}

function extractDocType(cedula: string): string {
  const match = cedula.match(/^([A-Z]-?)/);
  return match ? match[1].replace('-', '').trim() + '-' : 'V-';
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export default function SalesModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'pos' | 'history' | 'credits' | 'returns'>('pos');
  const [showReportType, setShowReportType] = useState<'REPORT_X' | 'REPORT_Z' | null>(null);
  const [reportSnapshot, setReportSnapshot] = useState<any>(null);
  const [cliente, setCliente] = useState('Consumidor final');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const processingRef = useRef(false);
  
  const [pagos, setPagos] = useState<PagoRealizado[]>([]);
  const [showMultiModal, setShowMultiModal] = useState(false);
  
  const [showAbonoModal, setShowAbonoModal] = useState<Debt | null>(null);
  
  const [showDetails, setShowDetails] = useState<any | null>(null);
  const [lastProcessedSale, setLastProcessedSale] = useState<any | null>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [selectedProductDisplay, setSelectedProductDisplay] = useState<Product | null>(null);
  
  const [priceSelectorItem, setPriceSelectorItem] = useState<{ index: number, product: Product } | null>(null);

  // ===== ESTADO PARA VENTA POR MONTO (ya no se usa visualmente, pero se conserva) =====
  const [montoVentaBS, setMontoVentaBS] = useState<string>('');
  const [cantidadCalculada, setCantidadCalculada] = useState<number | null>(null);

  // ===== ESTADOS PARA CREDIT MODAL =====
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Customer | null>(null);
  const [showNewClientForm, setShowNewClientForm] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', tipoDoc: 'V', cedula: '', phone: '', address: '' });

  // ===== ESTADO PARA VENTA DE EFECTIVO =====
  const [showCashSaleModal, setShowCashSaleModal] = useState(false);

  const [editandoTasa, setEditandoTasa] = useState(false);
  const [nuevaTasa, setNuevaTasa] = useState(state.tasa.toString());

  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showClientHistory, setShowClientHistory] = useState<string | null>(null);

  // ===== NUEVOS ESTADOS PARA FILTROS DE HISTORIAL =====
  const [historyDateFilter, setHistoryDateFilter] = useState<'today' | 'yesterday' | 'month' | 'custom'>('today');
  const [historyDateFrom, setHistoryDateFrom] = useState(Utils.hoy());
  const [historyDateTo, setHistoryDateTo] = useState(Utils.hoy());

  // ===== PAGINACIÓN DEL HISTORIAL =====
  const [historyPage, setHistoryPage] = useState(1);
  const pageSize = 10;

  // ===== NAVEGACIÓN DEL BUSCADOR =====
  const [selectedSearchIndex, setSelectedSearchIndex] = useState<number>(-1);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // ===== ESTADOS PARA VENTA FRACCIONADA =====
  const [showFraccionSelector, setShowFraccionSelector] = useState<{
    producto: Product;
  } | null>(null);
  const [montoFraccionBS, setMontoFraccionBS] = useState<number>(0);
  const [mlCalculados, setMlCalculados] = useState<number>(0);

  const formatCedulaByType = (val: string, type: string) => {
    if (type !== 'V' && type !== 'E') {
      return val.replace(/\D/g, '');
    }
    const digits = val.replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return digits.slice(0, 2) + '.' + digits.slice(2);
    if (digits.length <= 8) return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5);
    return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5, 8);
  };

  const handleNewClientCedulaChange = (val: string) => {
    const formatted = formatCedulaByType(val, newClient.tipoDoc);
    setNewClient({ ...newClient, cedula: formatted });
  };

  const handleNewClientTipoDocChange = (tipo: string) => {
    const cleanNumber = newClient.cedula.replace(/\./g, '');
    const formatted = formatCedulaByType(cleanNumber, tipo);
    setNewClient({ ...newClient, tipoDoc: tipo, cedula: formatted });
  };

  const currentTerminal = useMemo(() => {
    return auth?.currentUser ? state.terminales.find(t => t.usuarioId === auth.currentUser!.uid) : null;
  }, [state.terminales]);

  // Resetea la página al cambiar filtros de fecha
  useEffect(() => {
    setHistoryPage(1);
  }, [historyDateFilter, historyDateFrom, historyDateTo]);

  // Resetea el índice de búsqueda cuando cambia el texto o se cierra el dropdown
  useEffect(() => {
    setSelectedSearchIndex(-1);
  }, [search]);

  // ============================================================
  // CORRECCIÓN: getFreshReportData (modificada para calcular efectivo entregado)
  // ============================================================
  const getFreshReportData = () => {
    const corteTimestamp = state.fechaUltimoZ || '';
    const termId = currentTerminal?.id || 'GLOBAL';
    
    const vActivas = (state.ventas || []).filter(v => v.fecha > corteTimestamp && v.estado !== 'anulada' && v.terminalId === termId);
    const dHoy = (state.devoluciones || []).filter(d => d.fecha > corteTimestamp && d.terminalId === termId);
    const devUSD = dHoy.reduce((s, d) => s + d.totalUSD, 0);

    const anulacionesHoy = (state.anulaciones || [])
      .filter(a => a.fecha > corteTimestamp && a.terminalId === termId);
    const cantidadAnuladas = anulacionesHoy.length;

    const ventasEfectivo = vActivas.filter(v => 
      v.type === 'VENTA EFECTIVO BS' || 
      (v.items && v.items.some(item => item.productoId === 'SERVICIO_EFECTIVO'))
    );
    const ventasNormales = vActivas.filter(v => 
      v.type !== 'VENTA EFECTIVO BS' && 
      !(v.items && v.items.some(item => item.productoId === 'SERVICIO_EFECTIVO'))
    );
    
    const brUSD = ventasNormales.reduce((s, v) => s + v.totalUSD, 0);
    const descUSD = ventasNormales.reduce((s, v) => s + (v.descuentoUSD || 0), 0);
    const netUSD = brUSD - devUSD - descUSD;

    const efectivoVendidoUSD = ventasEfectivo.reduce((s, v) => s + v.totalUSD, 0);
    const efectivoVendidoBS = ventasEfectivo.reduce((s, v) => s + v.totalBS, 0);
    
    const comisionesUSD = (state.libroDiario || [])
      .filter(e => e.fecha > corteTimestamp && e.categoria === 'COMISION_EFECTIVO' && e.referencia.includes(termId))
      .reduce((s, e) => s + e.montoUSD, 0);
    const comisionesBS = comisionesUSD * state.tasa;
    
    // 🔑 EFECTIVO ENTREGADO = Total Vendido - Comisiones (ya que la comisión es la ganancia)
    const efectivoEntregadoUSD = efectivoVendidoUSD - comisionesUSD;
    const efectivoEntregadoBS = efectivoVendidoBS - comisionesBS;

    const baseImponibleUSD = ventasNormales.reduce((s, v) => s + (v.baseImponibleUSD || 0), 0);
    const ivaUSD = ventasNormales.reduce((s, v) => s + (v.ivaUSD || 0), 0);
    const exentoUSD = ventasNormales.reduce((s, v) => s + (v.exentoUSD || 0), 0);
    const igtfUSD = ventasNormales.reduce((s, v) => s + (v.igtfUSD || 0), 0);

    const paymentMethodsMap: Record<string, number> = {};
    vActivas.forEach(v => {
      if (v.payments && v.payments.length > 0) {
        v.payments.forEach(p => {
          paymentMethodsMap[p.metodo] = (paymentMethodsMap[p.metodo] || 0) + p.montoUSD;
        });
      } else if (v.metodoPago) {
        paymentMethodsMap[v.metodoPago] = (paymentMethodsMap[v.metodoPago] || 0) + v.totalUSD;
      }
    });

    const sortedVentas = vActivas.sort((a,b) => a.fecha.localeCompare(b.fecha));
    const desdeFactura = sortedVentas.length > 0 ? sortedVentas[0].id : 'N/A';
    const hastaFactura = sortedVentas.length > 0 ? sortedVentas[sortedVentas.length - 1].id : 'N/A';
    
    const sortedDevs = dHoy.sort((a,b) => a.fecha.localeCompare(b.fecha));
    const desdeNC = sortedDevs.length > 0 ? sortedDevs[0].id : 'N/A';
    const hastaNC = sortedDevs.length > 0 ? sortedDevs[sortedDevs.length - 1].id : 'N/A';

    const relevantDiario = (state.libroDiario || []).filter(e => e.fecha > corteTimestamp && e.referencia.includes(termId));
    const totalSalidasCaja = relevantDiario
      .filter(e => e.tipo === 'egreso' && e.categoria !== 'VENTA_EFECTIVO')
      .reduce((s, e) => s + e.montoUSD, 0);
    const totalEntradasCaja = relevantDiario
      .filter(e => e.tipo === 'ingreso' && e.categoria !== 'VENTA' && e.categoria !== 'COBRO_DEUDA' && e.categoria !== 'COMISION_EFECTIVO')
      .reduce((s, e) => s + e.montoUSD, 0);

    const salidasCajaUSD = relevantDiario
      .filter(e => e.tipo === 'egreso' && e.metodo === 'efectivo_usd' && e.categoria !== 'VENTA_EFECTIVO')
      .reduce((s, e) => s + e.montoUSD, 0);
    const salidasCajaBS = relevantDiario
      .filter(e => e.tipo === 'egreso' && e.metodo === 'efectivo_bs' && e.categoria !== 'VENTA_EFECTIVO')
      .reduce((s, e) => s + e.montoBS, 0);

    const entradasCajaUSD = relevantDiario
      .filter(e => e.tipo === 'ingreso' && e.metodo === 'efectivo_usd' && e.categoria !== 'VENTA' && e.categoria !== 'COBRO_DEUDA' && e.categoria !== 'COMISION_EFECTIVO')
      .reduce((s, e) => s + e.montoUSD, 0);
    const entradasCajaBS = relevantDiario
      .filter(e => e.tipo === 'ingreso' && e.metodo === 'efectivo_bs' && e.categoria !== 'VENTA' && e.categoria !== 'COBRO_DEUDA' && e.categoria !== 'COMISION_EFECTIVO')
      .reduce((s, e) => s + e.montoBS, 0);

    const terminalName = currentTerminal ? currentTerminal.nombre : 'SISTEMA GLOBAL';

    return { 
      brUSD, devUSD, descUSD, netUSD, igtfUSD, ivaUSD, baseImponibleUSD, exentoUSD,
      paymentMethods: paymentMethodsMap,
      manualSalidas: totalSalidasCaja,
      manualEntradas: totalEntradasCaja,
      manualSalidasUSD: salidasCajaUSD,
      manualSalidasBS: salidasCajaBS,
      manualEntradasUSD: entradasCajaUSD,
      manualEntradasBS: entradasCajaBS,
      fondoAperturaUSD: state.fondoCajaHoyUSD || 0,
      fondoAperturaBS: state.fondoCajaHoyBS || 0,
      desdeFactura, hastaFactura, desdeNC, hastaNC,
      stats: { 
        facturas: vActivas.length, 
        devoluciones: dHoy.length, 
        anulaciones: cantidadAnuladas, 
        ticketPromedio: vActivas.length > 0 ? (netUSD / vActivas.length) : 0 
      },
      fecha: Utils.ahora(), terminalName, terminalId: termId, numeroZ: state.ultimoZ + 1, acumuladoHistoricoUSD: state.acumuladoHistorico + netUSD,
      ventaEfectivo: {
        totalVendidoUSD: efectivoVendidoUSD,
        totalVendidoBS: efectivoVendidoBS,
        comisionesUSD: comisionesUSD,
        comisionesBS: comisionesBS,
        efectivoEntregadoUSD: efectivoEntregadoUSD,
        efectivoEntregadoBS: efectivoEntregadoBS,
        cantidadTransacciones: ventasEfectivo.length
      }
    };
  };

  const handleOpenReport = (type: 'REPORT_X' | 'REPORT_Z') => {
    const data = getFreshReportData();
    setReportSnapshot(data);
    setShowReportType(type);
  };

  const ejecutarCierreZ = async () => {
    const data = reportSnapshot;
    if (!data) return;
    const ahora = Utils.ahora();
    const numeroZ = state.ultimoZ + 1;
    const nuevoZ: ReportZ = {
      id: 'Z-' + String(numeroZ).padStart(6, '0'), fecha: ahora, numeroZ, terminalName: data.terminalName,
      desdeFactura: data.desdeFactura, hastaFactura: data.hastaFactura, desdeNotaCredito: data.desdeNC, hastaNotaCredito: data.hastaNC,
      cantidadAnuladas: data.stats.anulaciones, ventaBrutaUSD: data.brUSD, descuentoUSD: data.descUSD, devolucionesUSD: data.devUSD,
      ventaNetaUSD: data.netUSD, baseImponibleUSD: data.baseImponibleUSD, ivaUSD: data.ivaUSD, exentoUSD: data.exentoUSD,
      igtfUSD: data.igtfUSD, metodosPago: { ...data.paymentMethods }, 
      salidasCajaUSD: data.manualSalidasUSD || 0,
      salidasCajaBS: data.manualSalidasBS || 0,
      entradasCajaUSD: data.manualEntradasUSD || 0,
      entradasCajaBS: data.manualEntradasBS || 0,
      fondoAperturaUSD: data.fondoAperturaUSD, 
      fondoAperturaBS: data.fondoAperturaBS, 
      acumuladoHistoricoUSD: data.acumuladoHistoricoUSD, 
      stats: { ...data.stats },
      ventaEfectivo: data.ventaEfectivo || { 
        totalVendidoUSD: 0, 
        totalVendidoBS: 0, 
        comisionesUSD: 0,
        comisionesBS: 0,
        efectivoEntregadoUSD: 0,
        efectivoEntregadoBS: 0,
        cantidadTransacciones: 0 
      }
    };
    
    if (typeof localStorage !== 'undefined') localStorage.removeItem('posven_apertura_done');
    
    await Collections.set('reportesZ', nuevoZ.id, nuevoZ);
    updateState({ 
      ultimoZ: numeroZ, 
      fechaUltimoZ: ahora, 
      acumuladoHistorico: data.acumuladoHistoricoUSD, 
      fondoCajaHoyBS: 0, 
      fondoCajaHoyUSD: 0 
    });
    Store.set({ 
      ultimoZ: numeroZ, 
      fechaUltimoZ: ahora, 
      acumuladoHistorico: data.acumuladoHistoricoUSD, 
      fondoCajaHoyBS: 0, 
      fondoCajaHoyUSD: 0 
    });
    
    toast({ title: `Cierre Fiscal Z #${numeroZ} Exitoso` });
    setShowReportType(null);
  };

  const groupedCredits = useMemo(() => {
    const groups: Record<string, { totalUSD: number; debts: Debt[] }> = {};
    (state.cxc || []).filter(x => x.estado !== 'pagada').forEach(debt => {
      const name = debt.cliente || 'DESCONOCIDO';
      if (!groups[name]) groups[name] = { totalUSD: 0, debts: [] };
      groups[name].totalUSD += debt.saldoUSD;
      groups[name].debts.push(debt);
    });
    return groups;
  }, [state.cxc]);

  // ============================================================
  // FUNCIÓN GET STOCK DISPONIBLE (incluye venta fraccionada)
  // ============================================================
  const getStockDisponible = (p: Product) => {
    // Si es venta fraccionada, retornar stock en ml
    if (p.ventaFraccionada && p.stockML !== undefined) {
      return p.stockML;
    }
    
    let avail = p.stock || 0;
    if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems) {
      let compPossible = Infinity;
      p.kitItems.forEach(ki => {
        const cp = state.productos.find(c => c.id === ki.productoId);
        if (cp) compPossible = Math.min(compPossible, Math.floor((cp.stock || 0) / ki.cantidad));
        else compPossible = 0;
      });
      if (compPossible !== Infinity) avail = compPossible;
    }
    return avail;
  };

  // ============================================================
  // FUNCIÓN CALCULAR FRACCIÓN (CORREGIDA: usa precioUSD como precio por ml)
  // ============================================================
  const calcularFraccion = (montoBS: number, producto: Product): number => {
    const precioPorMlUSD = producto.precioUSD || 0;
    if (precioPorMlUSD <= 0) return 0;
    // Convertir monto BS a USD
    const montoUSD = montoBS / state.tasa;
    // Calcular ml
    return montoUSD / precioPorMlUSD;
  };

  // ============================================================
  // FUNCIÓN AGREGAR (modificada: fraccionado abre modal directo)
  // ============================================================
  const agregar = (pid: string) => {
    const p = state.productos.find(x => x.id === pid);
    if (!p) return;
    
    // Si el producto permite venta fraccionada -> abrir modal de fracción directamente
    if (p.ventaFraccionada) {
      setShowFraccionSelector({ producto: p });
      setMontoFraccionBS(0);
      setMlCalculados(0);
      return;
    }
    
    // Producto normal (no fraccionado)
    const stockAvail = getStockDisponible(p);
    if (stockAvail <= 0) {
      toast({ variant: "destructive", title: "Sin Stock" });
      return;
    }
    setSelectedProductDisplay(p);
    const nuevoCarrito = [...state.carrito];
    const idx = nuevoCarrito.findIndex(i => i.productoId === pid);
    if (idx >= 0) {
      if (nuevoCarrito[idx].cantidad >= stockAvail) return;
      nuevoCarrito[idx].cantidad++;
      nuevoCarrito[idx].subtotalUSD = nuevoCarrito[idx].cantidad * nuevoCarrito[idx].precioUnitUSD;
    } else {
      nuevoCarrito.push({ productoId: pid, nombre: p.nombre, precioUnitUSD: p.precioUSD, cantidad: 1, subtotalUSD: p.precioUSD });
    }
    updateState({ carrito: nuevoCarrito });
    setSearch('');
    setPagos([]);
    setMontoVentaBS('');
    setCantidadCalculada(null);
    setSelectedSearchIndex(-1);
    searchInputRef.current?.focus();
  };

  // ============================================================
  // FUNCIÓN AGREGAR FRACCIÓN AL CARRITO
  // ============================================================
  const agregarFraccion = () => {
    if (!showFraccionSelector) return;
    const p = showFraccionSelector.producto;
    
    const mlAVender = mlCalculados;
    const montoBS = montoFraccionBS;
    const montoUSD = montoBS / state.tasa;
    
    // Verificar stock disponible en ml
    const stockDisponibleML = p.stockML || 0;
    if (mlAVender > stockDisponibleML) {
      const botellasCompletas = Math.floor(stockDisponibleML / 1000);
      const mlRestantes = stockDisponibleML % 1000;
      toast({ 
        variant: "destructive", 
        title: "Stock insuficiente", 
        description: `Stock disponible: ${botellasCompletas}L + ${mlRestantes}ml` 
      });
      return;
    }
    
    // Verificar monto mínimo (mínimo 50ml) - usando precioUSD * 50ml * tasa
    const mlMinimo = 50;
    if (mlAVender < mlMinimo) {
      const precioMinimoUSD = (p.precioUSD || 0) * mlMinimo;
      const precioMinimoBS = precioMinimoUSD * state.tasa;
      toast({ 
        variant: "destructive", 
        title: "Monto mínimo", 
        description: `El monto mínimo es ${Utils.fmtBS(precioMinimoBS)} (${mlMinimo} ml)` 
      });
      return;
    }
    
    const nuevoCarrito = [...state.carrito];
    const idx = nuevoCarrito.findIndex(i => i.productoId === p.id && i.esFraccion === true);
    
    const item = {
      productoId: p.id,
      nombre: `${p.nombre} - ${mlAVender.toFixed(0)}ml (${Utils.fmtBS(montoBS)})`,
      precioUnitUSD: montoUSD,
      cantidad: 1,
      subtotalUSD: montoUSD,
      volumenML: mlAVender,
      montoBS: montoBS,
      esFraccion: true
    };
    
    if (idx >= 0) {
      const existing = nuevoCarrito[idx];
      const nuevoVolumen = (existing.volumenML || 0) + mlAVender;
      const nuevoMonto = (existing.montoBS || 0) + montoBS;
      nuevoCarrito[idx] = {
        ...existing,
        cantidad: 1,
        volumenML: nuevoVolumen,
        montoBS: nuevoMonto,
        subtotalUSD: nuevoMonto / state.tasa,
        precioUnitUSD: nuevoMonto / state.tasa,
        nombre: `${p.nombre} - ${nuevoVolumen.toFixed(0)}ml (${Utils.fmtBS(nuevoMonto)})`,
        esFraccion: true
      };
    } else {
      nuevoCarrito.push(item);
    }
    
    updateState({ carrito: nuevoCarrito });
    setShowFraccionSelector(null);
    setMontoFraccionBS(0);
    setMlCalculados(0);
    setSearch('');
    searchInputRef.current?.focus();
  };

  // ============================================================
  // EFECTO PARA ACTUALIZAR EL CARRITO EN TIEMPO REAL AL CAMBIAR EL MONTO EN BS
  // ============================================================
  useEffect(() => {
    if (!selectedProductDisplay) {
      return;
    }

    const monto = parseFloat(montoVentaBS.replace(/\./g, ''));
    if (isNaN(monto) || monto <= 0) {
      return;
    }

    const montoUSD = monto / state.tasa;
    const cantidad = montoUSD / selectedProductDisplay.precioUSD;

    if (cantidad <= 0) return;

    const cantidadRedondeada = Math.round(cantidad * 100) / 100;

    const stockAvail = getStockDisponible(selectedProductDisplay);
    if (cantidadRedondeada > stockAvail) {
      toast({ variant: "destructive", title: "Stock insuficiente", description: `Stock disponible: ${stockAvail} ${selectedProductDisplay.cantidad || 'und'}` });
      return;
    }

    const nuevoCarrito = [...state.carrito];
    const idx = nuevoCarrito.findIndex(i => i.productoId === selectedProductDisplay.id);
    if (idx >= 0) {
      nuevoCarrito[idx].cantidad = cantidadRedondeada;
      nuevoCarrito[idx].subtotalUSD = cantidadRedondeada * nuevoCarrito[idx].precioUnitUSD;
    } else {
      nuevoCarrito.push({
        productoId: selectedProductDisplay.id,
        nombre: selectedProductDisplay.nombre,
        precioUnitUSD: selectedProductDisplay.precioUSD,
        cantidad: cantidadRedondeada,
        subtotalUSD: cantidadRedondeada * selectedProductDisplay.precioUSD
      });
    }

    const currentCarrito = state.carrito;
    const same = currentCarrito.length === nuevoCarrito.length && 
                  currentCarrito.every((item, i) => 
                    item.productoId === nuevoCarrito[i].productoId && 
                    Math.abs(item.cantidad - nuevoCarrito[i].cantidad) < 0.0001
                  );
    if (!same) {
      updateState({ carrito: nuevoCarrito });
    }

  }, [montoVentaBS, selectedProductDisplay, state.tasa, state.carrito, updateState, getStockDisponible]);

  // ===== ACTUALIZAR CANTIDAD CALCULADA EN TIEMPO REAL (para mostrar) =====
  useEffect(() => {
    if (selectedProductDisplay && montoVentaBS) {
      const monto = parseFloat(montoVentaBS.replace(/\./g, ''));
      if (!isNaN(monto) && monto > 0) {
        const montoUSD = monto / state.tasa;
        const cantidad = montoUSD / selectedProductDisplay.precioUSD;
        const cantidadRedondeada = Math.round(cantidad * 100) / 100;
        setCantidadCalculada(cantidadRedondeada);
      } else {
        setCantidadCalculada(null);
      }
    } else {
      setCantidadCalculada(null);
    }
  }, [montoVentaBS, selectedProductDisplay, state.tasa]);

  const updateQty = (idx: number, delta: number) => {
    const nuevo = [...state.carrito];
    const item = nuevo[idx];
    const p = state.productos.find(x => x.id === item.productoId);
    if (!p) return;
    setSelectedProductDisplay(p);
    const stockAvail = getStockDisponible(p);
    const n = item.cantidad + delta;
    if (n <= 0) nuevo.splice(idx, 1);
    else if (n <= stockAvail) {
      item.cantidad = n;
      item.subtotalUSD = n * item.precioUnitUSD;
    }
    updateState({ carrito: nuevo });
    setPagos([]);
  };

  const handleQtyChange = (idx: number, newQty: number) => {
    const nuevo = [...state.carrito];
    const item = nuevo[idx];
    const p = state.productos.find(x => x.id === item.productoId);
    if (!p) return;
    const stockAvail = getStockDisponible(p);
    
    if (newQty <= 0) {
      nuevo.splice(idx, 1);
    } else if (newQty <= stockAvail) {
      item.cantidad = newQty;
      item.subtotalUSD = newQty * item.precioUnitUSD;
    } else {
      toast({ variant: "destructive", title: `Stock insuficiente (máx: ${stockAvail})` });
      return;
    }
    updateState({ carrito: nuevo });
    setPagos([]);
  };

  const handlePriceChange = (index: number, newPrice: number) => {
    const nuevo = [...state.carrito];
    nuevo[index].precioUnitUSD = newPrice;
    nuevo[index].subtotalUSD = nuevo[index].cantidad * newPrice;
    updateState({ carrito: nuevo });
    setPriceSelectorItem(null);
    toast({ title: "Precio Actualizado", description: `Nuevo precio: ${Utils.fmtUSD(newPrice)}` });
  };

  const subtotalUSD = state.carrito.reduce((s, i) => s + i.subtotalUSD, 0);
  const totalBS = subtotalUSD * state.tasa;
  const totalPagadoUSD = pagos.reduce((s, p) => s + p.montoUSD, 0);
  const saldoRestanteUSD = Math.max(0, subtotalUSD - totalPagadoUSD);

  // Resultados de búsqueda
  const matches = useMemo(() => {
    if (search.trim().length === 0) return [];
    return state.productos
      .filter(p => p.activo && (p.nombre.toLowerCase().includes(search.toLowerCase()) || p.codigo.toLowerCase().includes(search.toLowerCase())))
      .slice(0, 8);
  }, [search, state.productos]);

  const filteredClients = useMemo(() => {
    if (clientSearch.trim().length === 0) return [];
    const searchLower = clientSearch.toLowerCase();
    const searchNumeric = clientSearch.replace(/\D/g, '');

    return (state.clientes || []).filter(c => {
      const nameMatch = (c.name || '').toLowerCase().includes(searchLower);
      const cedulaExactMatch = (c.cedula || '').toLowerCase().includes(searchLower);
      const cedulaNumericMatch = searchNumeric.length > 0 && (c.cedula || '').replace(/\D/g, '').includes(searchNumeric);

      return nameMatch || cedulaExactMatch || cedulaNumericMatch;
    });
  }, [clientSearch, state.clientes]);

  const getCurrentTerminal = () => currentTerminal;

  const guardarNuevaTasa = () => {
    const n = parseFloat(nuevaTasa);
    if (isNaN(n) || n <= 0) return alert('Tasa inválida');
    updateState({ tasa: n });
    Store.set({ tasa: n });
    setEditandoTasa(false);
  };

  // ============================================================
  // FUNCIONES DE VENTA CORREGIDAS (con locks y guardado en colecciones)
  // ============================================================
  const ejecutarVenta = async (pagosFinales?: PagoRealizado[]) => {
    if (processingRef.current) return;
    if (state.carrito.length === 0) return;

    processingRef.current = true;
    setIsProcessing(true);

    try {
      const listadoPagos = pagosFinales || pagos;
      const totalPagadoRecibido = listadoPagos.reduce((s, p) => s + p.montoUSD, 0);
      const terminal = getCurrentTerminal();
      
      const nextNum = terminal?.proximoRecibo || state.proximoRecibo;
      const reciboId = String(nextNum).padStart(9, '0');
      const ahoraStr = Utils.ahora();
      
      let vExento = 0, vBase = 0, vIVA = 0;
      const prodsActualizados: Product[] = [];
      const nuevosMovimientos: Movimiento[] = [];

      // Procesar cada item del carrito
      for (const item of state.carrito) {
        const p = state.productos.find(x => x.id === item.productoId);
        if (!p) continue;
        
        if (p.aplicaIVA) { 
          const base = item.subtotalUSD / 1.16; 
          vBase += base; 
          vIVA += (item.subtotalUSD - base); 
        } else { 
          vExento += item.subtotalUSD; 
        }
        
        // ===== VENTA FRACCIONADA (descuenta en ml) =====
        if (p.ventaFraccionada && item.esFraccion && item.volumenML) {
          const nuevoStockML = (p.stockML || 0) - item.volumenML;
          const pActualizado = { ...p, stockML: nuevoStockML };
          await Collections.set('productos', p.id, pActualizado);
          prodsActualizados.push(pActualizado);
          
          const mov: Movimiento = {
            id: Store.uid(),
            productoId: item.productoId,
            tipo: 'venta',
            cantidad: -item.volumenML,
            stockAntes: p.stockML || 0,
            stockDespues: nuevoStockML,
            fecha: ahoraStr,
            referencia: `VENTA FRACCIONADA ${reciboId} - ${item.volumenML}ml`,
            terminalId: terminal?.id || 'GLOBAL'
          };
          await Collections.set('movimientos', mov.id, mov);
          nuevosMovimientos.push(mov);
          continue;
        }
        
        // ===== KITS =====
        if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems) {
          for (const ki of p.kitItems) {
            const cp = state.productos.find(c => c.id === ki.productoId);
            if (cp) {
              const qty = item.cantidad * ki.cantidad;
              const stockAntes = cp.stock;
              const cpActualizado = { ...cp, stock: cp.stock - qty };
              await Collections.set('productos', cp.id, cpActualizado);
              
              const mov: Movimiento = {
                id: Store.uid(),
                productoId: cp.id,
                tipo: 'venta',
                cantidad: -qty,
                stockAntes,
                stockDespues: cpActualizado.stock,
                fecha: ahoraStr,
                referencia: `KIT: ${p.nombre} - VENTA ${reciboId}`,
                terminalId: terminal?.id || 'GLOBAL'
              };
              await Collections.set('movimientos', mov.id, mov);
              nuevosMovimientos.push(mov);
            }
          }
        } else if (!p.ventaFraccionada) {
          // ===== PRODUCTO NORMAL =====
          const stockAntes = p.stock;
          const pActualizado = { ...p, stock: p.stock - item.cantidad };
          await Collections.set('productos', p.id, pActualizado);
          
          const mov: Movimiento = {
            id: Store.uid(),
            productoId: item.productoId,
            tipo: 'venta',
            cantidad: -item.cantidad,
            stockAntes,
            stockDespues: pActualizado.stock,
            fecha: ahoraStr,
            referencia: `VENTA ${reciboId}`,
            terminalId: terminal?.id || 'GLOBAL'
          };
          await Collections.set('movimientos', mov.id, mov);
          nuevosMovimientos.push(mov);
        }
      }

      const vIgtf = listadoPagos.filter(p => p.metodo === 'efectivo_usd' || p.metodo === 'zelle').reduce((acc, p) => acc + (p.montoUSD * 0.03), 0);
      
      const nuevaVenta: Sale = { 
        id: reciboId, 
        fecha: ahoraStr, 
        cliente, 
        items: [...state.carrito], 
        subtotalUSD, 
        descuentoUSD: 0, 
        totalUSD: subtotalUSD, 
        totalBS, 
        metodoPago: listadoPagos.length > 1 ? 'mixto' : (listadoPagos[0]?.metodo || 'efectivo_usd'), 
        estado: 'completada', 
        type: 'VENTA', 
        received: totalPagadoRecibido, 
        change: Math.max(0, totalPagadoRecibido - subtotalUSD), 
        payments: [...listadoPagos], 
        terminalId: terminal?.id || 'GLOBAL',
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL',
        cajeroId: auth?.currentUser?.uid, 
        baseImponibleUSD: Utils.round(vBase), 
        ivaUSD: Utils.round(vIVA), 
        exentoUSD: Utils.round(vExento), 
        igtfUSD: Utils.round(vIgtf),
        tasa: state.tasa
      };
      
      // Guardar venta
      await Collections.set('ventas', reciboId, nuevaVenta);
      
      // Guardar libro diario
      for (const p of listadoPagos) {
        const asiento: LibroDiarioEntry = {
          id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
          fecha: ahoraStr,
          tipo: 'ingreso',
          categoria: 'VENTA',
          concepto: `VENTA #${reciboId} - CLIENTE: ${cliente.toUpperCase()}`,
          montoUSD: p.montoUSD,
          montoBS: p.montoBS,
          metodo: p.metodo,
          referencia: reciboId + '-' + (terminal?.id || 'GLOBAL')
        };
        await Collections.set('libroDiario', asiento.id, asiento);
      }
      
      // Actualizar terminal (proximoRecibo)
      if (terminal) {
        await Collections.update('terminales', terminal.id, { 
          proximoRecibo: nextNum + 1 
        });
      }
      
      // Limpiar carrito
      updateState({ carrito: [] });
      
      setLastProcessedSale(nuevaVenta); 
      setShowReceiptModal(true); 
      setPagos([]); 
      setCliente('Consumidor final'); 
      setSelectedProductDisplay(null);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const ejecutarAbono = async (pagosAbono: PagoRealizado[]) => {
    if (!showAbonoModal) return;
    if (processingRef.current) return;
    processingRef.current = true;
    setIsProcessing(true);

    try {
      const totalAbonado = pagosAbono.reduce((s, p) => s + p.montoUSD, 0);
      if (totalAbonado <= 0) return;
      const ahoraStr = Utils.ahora(), terminal = getCurrentTerminal();
      const nextNum = terminal?.proximoRecibo || state.proximoRecibo;
      const reciboId = 'PAY-' + String(nextNum).padStart(6, '0');
      
      // Actualizar deuda en cxc
      const deudaActual = state.cxc.find(d => d.id === showAbonoModal.id);
      if (deudaActual) {
        const nuevoSaldo = Math.max(0, deudaActual.saldoUSD - totalAbonado);
        const deudaActualizada: Debt = { 
          ...deudaActual, 
          abonadoUSD: deudaActual.abonadoUSD + totalAbonado, 
          saldoUSD: nuevoSaldo, 
          estado: (nuevoSaldo <= 0.001 ? 'pagada' : 'parcial') as 'pagada' | 'parcial', 
          historialPagos: [...(deudaActual.historialPagos || []), { 
            fecha: ahoraStr, 
            montoUSD: totalAbonado, 
            montoBS: totalAbonado * state.tasa, 
            metodo: pagosAbono.length > 1 ? 'mixto' : pagosAbono[0].metodo, 
            reciboId 
          }] 
        };
        await Collections.set('cxc', deudaActual.id, deudaActualizada);
      }
      
      // Guardar libro diario
      for (const p of pagosAbono) {
        const asiento: LibroDiarioEntry = {
          id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
          fecha: ahoraStr,
          tipo: 'ingreso',
          categoria: 'COBRO_DEUDA',
          concepto: `ABONO DEUDA #${showAbonoModal.id} - CLIENTE: ${showAbonoModal.cliente?.toUpperCase()}`,
          montoUSD: p.montoUSD,
          montoBS: p.montoBS,
          metodo: p.metodo,
          referencia: reciboId + '-' + (terminal?.id || 'GLOBAL')
        };
        await Collections.set('libroDiario', asiento.id, asiento);
      }
      
      const saleAbono: Sale = { 
        id: reciboId, 
        fecha: ahoraStr, 
        cliente: showAbonoModal.cliente || 'CLIENTE', 
        items: [{ productoId: 'ABONO', nombre: `ABONO A FACTURA #${showAbonoModal.id}`, cantidad: 1, precioUnitUSD: totalAbonado, subtotalUSD: totalAbonado }], 
        subtotalUSD: totalAbonado, 
        descuentoUSD: 0, 
        totalUSD: totalAbonado, 
        totalBS: totalAbonado * state.tasa, 
        metodoPago: pagosAbono.length > 1 ? 'mixto' : pagosAbono[0].metodo, 
        estado: 'completada', 
        type: 'COBRO DEUDA', 
        payments: [...pagosAbono], 
        terminalId: terminal?.id || 'GLOBAL',
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL',
        tasa: state.tasa
      };
      
      await Collections.set('ventas', reciboId, saleAbono);
      
      // Actualizar terminal (proximoRecibo)
      if (terminal) {
        await Collections.update('terminales', terminal.id, { 
          proximoRecibo: nextNum + 1 
        });
      }
      
      setLastProcessedSale(saleAbono); 
      setShowReceiptModal(true); 
      setShowAbonoModal(null);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const ejecutarVentaACredito = async (customer: Customer) => {
    if (state.carrito.length === 0) return;
    if (processingRef.current) return;
    if (!customer) return alert("Seleccione un cliente.");
    
    processingRef.current = true;
    setIsProcessing(true);

    try {
      const terminal = getCurrentTerminal();
      const nextNum = terminal?.proximoRecibo || state.proximoRecibo;
      const reciboId = String(nextNum).padStart(9, '0');
      const ahoraStr = Utils.ahora();
      
      let vExento = 0, vBase = 0, vIVA = 0;
      const nuevosMovimientos: Movimiento[] = [];

      // Procesar cada item del carrito
      for (const item of state.carrito) {
        const p = state.productos.find(x => x.id === item.productoId);
        if (!p) continue;
        
        if (p.aplicaIVA) { 
          const base = item.subtotalUSD / 1.16; 
          vBase += base; 
          vIVA += (item.subtotalUSD - base); 
        } else { 
          vExento += item.subtotalUSD; 
        }
        
        // ===== VENTA FRACCIONADA =====
        if (p.ventaFraccionada && item.esFraccion && item.volumenML) {
          const nuevoStockML = (p.stockML || 0) - item.volumenML;
          const pActualizado = { ...p, stockML: nuevoStockML };
          await Collections.set('productos', p.id, pActualizado);
          
          const mov: Movimiento = {
            id: Store.uid(),
            productoId: item.productoId,
            tipo: 'venta',
            cantidad: -item.volumenML,
            stockAntes: p.stockML || 0,
            stockDespues: nuevoStockML,
            fecha: ahoraStr,
            referencia: `VENTA FRACCIONADA ${reciboId} - ${item.volumenML}ml`,
            terminalId: terminal?.id || 'GLOBAL'
          };
          await Collections.set('movimientos', mov.id, mov);
          nuevosMovimientos.push(mov);
          continue;
        }
        
        if (p.isKit && p.kitType === 'stock_componentes' && p.kitItems) {
          for (const ki of p.kitItems) {
            const cp = state.productos.find(c => c.id === ki.productoId);
            if (cp) {
              const qty = item.cantidad * ki.cantidad;
              const stockAntes = cp.stock;
              const cpActualizado = { ...cp, stock: cp.stock - qty };
              await Collections.set('productos', cp.id, cpActualizado);
              
              const mov: Movimiento = {
                id: Store.uid(),
                productoId: cp.id,
                tipo: 'venta',
                cantidad: -qty,
                stockAntes,
                stockDespues: cpActualizado.stock,
                fecha: ahoraStr,
                referencia: `KIT: ${p.nombre} - CRÉDITO ${reciboId}`,
                terminalId: terminal?.id || 'GLOBAL'
              };
              await Collections.set('movimientos', mov.id, mov);
              nuevosMovimientos.push(mov);
            }
          }
        } else if (!p.ventaFraccionada) {
          const stockAntes = p.stock;
          const pActualizado = { ...p, stock: p.stock - item.cantidad };
          await Collections.set('productos', p.id, pActualizado);
          
          const mov: Movimiento = {
            id: Store.uid(),
            productoId: item.productoId,
            tipo: 'venta',
            cantidad: -item.cantidad,
            stockAntes,
            stockDespues: pActualizado.stock,
            fecha: ahoraStr,
            referencia: `CRÉDITO ${reciboId}`,
            terminalId: terminal?.id || 'GLOBAL'
          };
          await Collections.set('movimientos', mov.id, mov);
          nuevosMovimientos.push(mov);
        }
      }
      
      const nuevaVenta: Sale = { 
        id: reciboId, 
        fecha: ahoraStr, 
        cliente: customer.name, 
        items: [...state.carrito], 
        subtotalUSD, 
        descuentoUSD: 0, 
        totalUSD: subtotalUSD, 
        totalBS, 
        metodoPago: 'credito', 
        estado: 'completada', 
        type: 'VENTA CRÉDITO', 
        received: 0, 
        change: 0, 
        terminalId: terminal?.id || 'GLOBAL',
        terminalName: terminal?.nombre || 'SISTEMA GLOBAL',
        cajeroId: auth?.currentUser?.uid, 
        baseImponibleUSD: Utils.round(vBase), 
        ivaUSD: Utils.round(vIVA), 
        exentoUSD: Utils.round(vExento), 
        igtfUSD: 0,
        tasa: state.tasa
      };
      
      await Collections.set('ventas', reciboId, nuevaVenta);
      
      const cedulaNormalizada = normalizeCedula(customer.cedula, extractDocType(customer.cedula));
      const nombreCliente = customer.name;
      
      const nuevaDeuda: Debt = { 
        id: 'CRD-' + reciboId.slice(-6), 
        fecha: ahoraStr.slice(0, 10), 
        fechaVencimiento: '2099-12-31', 
        cliente: `${nombreCliente} [${cedulaNormalizada}]`, 
        montoUSD: subtotalUSD, 
        abonadoUSD: 0, 
        saldoUSD: subtotalUSD, 
        estado: 'pendiente' as 'pendiente', 
        historialPagos: [], 
        ventaId: reciboId 
      };
      
      await Collections.set('cxc', nuevaDeuda.id, nuevaDeuda);
      
      // Actualizar cliente con nueva deuda
      if (customer.id) {
        const clienteActualizado = { ...customer, debt: (customer.debt || 0) + subtotalUSD };
        await Collections.set('clientes', customer.id, clienteActualizado);
      }
      
      // Actualizar terminal
      if (terminal) {
        await Collections.update('terminales', terminal.id, { 
          proximoRecibo: nextNum + 1 
        });
      }
      
      // Limpiar carrito
      updateState({ carrito: [] });
      
      setLastProcessedSale(nuevaVenta); 
      setShowReceiptModal(true); 
      setIsCreditModalOpen(false); 
      setSelectedClient(null);
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  const handleCreditModalConfirm = (customer: Customer, amount: number) => {
    if (customer.cedula && !customer.cedula.includes('.')) {
      const tipo = extractDocType(customer.cedula);
      const cedulaNormalizada = normalizeCedula(customer.cedula, tipo);
      const customers = state.clientes || [];
      const exists = findCustomerByCedula(customers, cedulaNormalizada);
      if (exists) {
        setSelectedClient(exists);
        setIsCreditModalOpen(false);
        setTimeout(() => ejecutarVentaACredito(exists), 100);
        return;
      }
      customer.cedula = cedulaNormalizada;
    }
    setSelectedClient(customer);
    setIsCreditModalOpen(false);
    setTimeout(() => ejecutarVentaACredito(customer), 100);
  };

  // ============================================================
  // VENTA DE EFECTIVO CON CONTADOR POR TERMINAL Y ACTUALIZACIÓN INMEDIATA
  // ============================================================
  const procesarVentaEfectivo = (data: {
    montoEfectivoBS: number;
    totalAPagarBS: number;
    comision: number;
    metodoPago: string;
  }) => {
    const ahoraStr = Utils.ahora();
    const terminal = getCurrentTerminal();
    const nextNum = terminal?.proximaVentaEfectivo || 1;
    const reciboId = 'EFE-' + String(nextNum).padStart(7, '0');

    const totalUSD = data.totalAPagarBS / state.tasa;
    const efectivoUSD = data.montoEfectivoBS / state.tasa;
    const comisionUSD = totalUSD - efectivoUSD;
    const comisionBS = data.totalAPagarBS - data.montoEfectivoBS;

    const itemEspecial = {
      productoId: 'SERVICIO_EFECTIVO',
      nombre: `VENTA DE EFECTIVO Bs. (${data.comision}% comisión)`,
      cantidad: 1,
      precioUnitUSD: totalUSD,
      subtotalUSD: totalUSD
    };

    const nuevaVenta: Sale = {
      id: reciboId,
      fecha: ahoraStr,
      cliente: cliente || 'CONSUMIDOR FINAL',
      items: [itemEspecial],
      subtotalUSD: totalUSD,
      descuentoUSD: 0,
      totalUSD: totalUSD,
      totalBS: data.totalAPagarBS,
      metodoPago: data.metodoPago,
      estado: 'completada',
      type: 'VENTA EFECTIVO BS',
      received: totalUSD,
      change: 0,
      payments: [{
        metodo: data.metodoPago as PaymentMethod,
        montoUSD: totalUSD,
        montoBS: data.totalAPagarBS
      }],
      terminalId: terminal?.id || 'GLOBAL',
      terminalName: terminal?.nombre || 'SISTEMA GLOBAL',
      cajeroId: auth?.currentUser?.uid,
      baseImponibleUSD: totalUSD,
      ivaUSD: 0,
      exentoUSD: totalUSD,
      igtfUSD: 0,
      tasa: state.tasa
    };

    // ÚNICO ASIENTO: comisión ganada (ingreso)
    const asientoComision: LibroDiarioEntry = {
      id: 'ACC-' + Store.uid().toUpperCase().slice(0, 5),
      fecha: ahoraStr,
      tipo: 'ingreso',
      categoria: 'COMISION_EFECTIVO',
      concepto: `COMISIÓN POR VENTA DE EFECTIVO: Bs. ${data.montoEfectivoBS.toFixed(2)} entregados (USD ${efectivoUSD.toFixed(2)}), comisión ${data.comision}% = USD ${comisionUSD.toFixed(2)} (Bs. ${comisionBS.toFixed(2)})`,
      montoUSD: comisionUSD,
      montoBS: comisionBS,
      metodo: data.metodoPago as PaymentMethod,
      referencia: reciboId + '-' + (terminal?.id || 'GLOBAL')
    };

    // 🔑 Guardar en Firestore (solo la comisión)
    Collections.set('ventas', reciboId, nuevaVenta);
    Collections.set('libroDiario', asientoComision.id, asientoComision);

    // 🔑 Actualizar estado local INMEDIATAMENTE
    updateState({ 
      ventas: [...state.ventas, nuevaVenta],
      libroDiario: [asientoComision, ...(state.libroDiario || [])]
    });

    // Actualizar contador del terminal
    if (terminal) {
      Collections.update('terminales', terminal.id, { 
        proximaVentaEfectivo: nextNum + 1 
      });
    }

    toast({
      title: "Venta de Efectivo Registrada",
      description: `Se entregaron ${Utils.fmtBS(data.montoEfectivoBS)} en efectivo. Cobro: ${Utils.fmtBS(data.totalAPagarBS)} (${data.comision}% comisión)`,
      duration: 5000
    });

    setShowCashSaleModal(false);
  };

  // ============================================================
  // FILTRO DE HISTORIAL POR FECHA
  // ============================================================
  const filteredHistory = useMemo(() => {
    let list = (state.ventas || []).filter(v => 
      v.terminalId === currentTerminal?.id && 
      v.fecha > (state.fechaUltimoZ || '') &&
      v.estado !== 'anulada'
    );

    if (list.length === 0) return [];

    const today = Utils.hoy();
    let from = today, to = today;

    if (historyDateFilter === 'today') {
      from = today;
      to = today;
    } else if (historyDateFilter === 'yesterday') {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      from = yesterday.toISOString().slice(0,10);
      to = from;
    } else if (historyDateFilter === 'month') {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      from = firstDay.toISOString().slice(0,10);
      to = today;
    } else if (historyDateFilter === 'custom') {
      from = historyDateFrom;
      to = historyDateTo;
    }

    return list.filter(v => {
      const vDate = v.fecha.slice(0,10);
      return vDate >= from && vDate <= to;
    });
  }, [state.ventas, currentTerminal, state.fechaUltimoZ, historyDateFilter, historyDateFrom, historyDateTo]);

  // ============================================================
  // PAGINACIÓN DEL HISTORIAL
  // ============================================================
  const totalPages = Math.ceil(filteredHistory.length / pageSize);
  const paginatedHistory = filteredHistory.slice((historyPage - 1) * pageSize, historyPage * pageSize);

  // ============================================================
  // MANEJADORES DEL BUSCADOR CON TECLADO (CORREGIDO: ESC siempre limpia)
  // ============================================================
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ESC siempre debe limpiar la búsqueda, incluso si no hay coincidencias
    if (e.key === 'Escape') {
      e.preventDefault();
      setSearch('');
      setSelectedSearchIndex(-1);
      return;
    }

    const list = matches;
    if (list.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSearchIndex(prev => (prev + 1) % list.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSearchIndex(prev => (prev - 1 + list.length) % list.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const idx = selectedSearchIndex >= 0 ? selectedSearchIndex : 0;
      if (list[idx]) {
        agregar(list[idx].id);
      }
    }
  };

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="flex flex-col gap-2 h-[calc(100vh-100px)] max-w-7xl mx-auto w-full overflow-hidden">
      {/* ===== BARRA DE HERRAMIENTAS ===== */}
      <div className="flex gap-2 no-print shrink-0 overflow-x-auto pb-1 items-center">
        <button onClick={() => setView('pos')} className={`btn btn-sm ${view === 'pos' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><ShoppingCart className="w-3.5 h-3.5"/> Punto de Venta</button>
        <button onClick={() => setView('history')} className={`btn btn-sm ${view === 'history' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><History className="w-3.5 h-3.5"/> Historial</button>
        <button onClick={() => setView('credits')} className={`btn btn-sm ${view === 'credits' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><ClipboardList className="w-3.5 h-3.5"/> Consultar Créditos</button>
        <button onClick={() => handleOpenReport('REPORT_X')} className="btn btn-sm bg-white text-ink font-bold border-line border"><FileText className="w-3.5 h-3.5"/> Reporte X</button>
        <button onClick={() => handleOpenReport('REPORT_Z')} className="btn btn-sm bg-white text-ink font-bold border-line border"><Receipt className="w-3.5 h-3.5"/> Reporte Z</button>
        <button onClick={() => setView('returns')} className={`btn btn-sm ${view === 'returns' ? 'btn-primary shadow-md' : 'bg-white text-ink font-bold border-line border'}`}><RotateCcw className="w-3.5 h-3.5"/> Devoluciones y Anulaciones</button>
        
        {view === 'pos' && (
          <button 
            onClick={() => setIsFullScreen(!isFullScreen)} 
            className="btn btn-sm bg-white text-ink font-bold border-line border ml-auto hover:bg-brand-gold-soft transition-colors"
            title={isFullScreen ? "Minimizar" : "Expandir Pantalla Completa"}
          >
            {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* ===== VISTA POS ===== */}
      {view === 'pos' ? (
        <div className={cn(
          "flex flex-col gap-2 flex-1 overflow-hidden animate-in fade-in duration-300",
          isFullScreen && "fixed inset-0 z-[100] bg-surface-warm p-6 overflow-hidden flex flex-col"
        )}>
          <div className="flex items-center gap-3 shrink-0 mb-1">
            {/* ===== BUSCADOR CON NAVEGACIÓN POR TECLADO ===== */}
            <div className="relative group flex-1">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#c8952e] z-10"><Barcode className="w-5 h-5" /></div>
              <input
                ref={searchInputRef}
                className="form-input pl-14 py-2 text-base bg-white border-brand-gold/30 text-ink font-black placeholder-ink/40"
                placeholder="Escanee o busque producto..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                autoFocus
              />
              {matches.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border border-line rounded-b-lg shadow-2xl z-[100] mt-1 overflow-hidden">
                  {matches.map((p, index) => (
                    <div
                      key={p.id}
                      onClick={() => agregar(p.id)}
                      className={`flex items-center justify-between p-3 cursor-pointer border-b border-line transition-colors ${
                        selectedSearchIndex === index ? 'bg-brand-gold/20 border-brand-gold' : 'hover:bg-brand-gold/10'
                      }`}
                    >
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-ink text-sm font-black uppercase truncate">{p.nombre}</span>
                        <span className="text-ink/60 text-[10px] mono font-bold">{p.codigo}</span>
                      </div>
                      <div className="flex items-center gap-10 shrink-0 ml-4">
                         <div className="flex flex-col items-end min-w-[70px]">
                           <span className="text-[9px] font-black uppercase text-ink/40 mb-0.5">Stock</span>
                           <span className={`text-lg font-black leading-none ${p.stock <= (p.stockMinimo || 3) ? 'text-red-600' : p.stock <= (p.stockMinimo || 3) * 2 ? 'text-amber-500' : 'text-green-600'}`}>
                             {p.stock} <span className="text-[10px] opacity-60">Und.</span>
                           </span>
                         </div>
                         <div className="flex items-center gap-2">
                           <div className="flex flex-col items-end min-w-[90px]">
                             <span className="text-[9px] font-black uppercase text-ink/40 mb-0.5">Precio USD</span>
                             <span className="text-lg font-black leading-none text-ink">{Utils.fmtUSD(p.precioUSD)}</span>
                           </div>
                           <div className="flex flex-col items-end min-w-[110px]">
                             <span className="text-[9px] font-black uppercase text-ink/40 mb-0.5">Equiv. BS</span>
                             <span className="text-lg font-black leading-none text-brand-gold-deep">{Utils.fmtBS(p.precioUSD * state.tasa)}</span>
                           </div>
                         </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ===== TASA ===== */}
            <div className="flex items-center gap-2 bg-white px-4 py-1.5 rounded-full border border-brand-gold/30 shadow-sm shrink-0">
              <div className="w-8 h-8 rounded-full overflow-hidden border border-line shrink-0"><img src="/bcv-logo.png" alt="BCV" className="w-full h-full object-cover" /></div>
              <div className="flex items-center gap-1.5">{!editandoTasa ? (<><span className="text-ink font-black text-sm tabular-nums">{state.tasa.toFixed(2)}</span><button onClick={() => { setEditandoTasa(true); setNuevaTasa(state.tasa.toString()); }} className="text-brand-gold hover:text-brand-gold-deep p-0.5 transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button></>) : (<><input type="text" value={nuevaTasa} onChange={e => setNuevaTasa(e.target.value.replace(/[^0-9.]/g, ''))} className="w-16 bg-surface-soft border border-brand-gold rounded px-1.5 py-0.5 text-ink font-black text-sm text-right outline-none" autoFocus /><button onClick={guardarNuevaTasa} className="text-status-success p-0.5"><Check className="w-4 h-4" /></button><button onClick={() => setEditandoTasa(false)} className="text-status-danger p-0.5"><X className="w-4 h-4" /></button></>)}</div>
            </div>
          </div>

          {/* ===== CUERPO PRINCIPAL ===== */}
          <div className="flex flex-1 gap-3 overflow-hidden">
            {/* ===== COLUMNA IZQUIERDA ===== */}
            <div className="w-1/4 flex flex-col gap-2">
              <div className="card p-3 space-y-3 bg-white border-line h-full flex flex-col">
                <div className="form-group mb-0">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">IDENTIFICACIÓN CLIENTE</label>
                  <input className="form-input h-8 text-xs bg-surface-soft text-ink border-line font-black uppercase" value={cliente} onChange={e => setCliente(e.target.value)} />
                </div>

                <button 
                  onClick={() => setShowCashSaleModal(true)} 
                  className="w-full h-10 bg-[#D4A017] text-white font-black uppercase text-[10px] rounded-xl transition-all hover:bg-[#E8B831] flex items-center justify-center gap-2 shadow-sm"
                  title="Venta de Efectivo"
                >
                  <Banknote className="w-4 h-4" />
                  Venta Efectivo
                </button>

                <div className="flex-1 overflow-y-auto space-y-2 pt-2 border-t border-line/10">
                  {selectedProductDisplay && (
                    <div className="space-y-3 animate-in slide-in-from-bottom-2 duration-300">
                       <div className="p-3 bg-surface-soft border border-line rounded-xl text-center">
                         <span className="text-[9px] font-black uppercase text-ink opacity-40 block mb-1">STOCK DISPONIBLE</span>
                         <span className={`text-2xl font-black ${selectedProductDisplay.stock <= (selectedProductDisplay.stockMinimo || 3) ? 'text-status-danger' : selectedProductDisplay.stock <= (selectedProductDisplay.stockMinimo || 3) * 2 ? 'text-status-warn' : 'text-status-success'}`}>
                           {selectedProductDisplay.stock} <span className="text-xs">{selectedProductDisplay.cantidad || 'UND'}</span>
                         </span>
                       </div>
                       <div className="p-3 bg-surface-soft border border-line rounded-xl text-center">
                         <span className="text-[9px] font-black uppercase text-ink opacity-40 block mb-1">PRECIO UNITARIO USD</span>
                         <span className="text-2xl font-black text-ink">{Utils.fmtUSD(selectedProductDisplay.precioUSD)}</span>
                       </div>
                       <div className="p-3 bg-brand-gold-soft/30 border border-brand-gold-soft/30 rounded-xl text-center">
                         <span className="text-[9px] font-black uppercase text-brand-gold-deep block mb-1">EQUIVALENTE EN BOLÍVARES</span>
                         <span className="text-2xl font-black text-brand-gold-deep">{Utils.fmtBS(selectedProductDisplay.precioUSD * state.tasa)}</span>
                       </div>
                    </div>
                  )}
                  {state.carrito.length > 0 && (
                    <button onClick={() => setIsCreditModalOpen(true)} className="w-full h-10 border-2 border-status-info text-status-info hover:bg-status-info-soft font-black uppercase text-[10px] rounded-xl transition-all mt-4">Cargar a Crédito</button>
                  )}
                </div>
              </div>
            </div>

            {/* ===== COLUMNA DERECHA (CARRITO) ===== */}
            <div className="w-3/4 flex flex-col gap-2 overflow-hidden">
              <div className="card flex-1 flex flex-col overflow-hidden bg-white border-none shadow-xl">
                <div className="grid grid-cols-[1fr_80px_70px_35px_80px_80px_80px_35px] gap-1 px-3 py-3 bg-ink text-white text-[10px] font-black uppercase tracking-[0.12em] rounded-t-lg">
                  <div>Descripción</div>
                  <div className="text-center">Cant</div>
                  <div className="text-center">U.M.</div>
                  <div />
                  <div className="text-right">Precio ($)</div>
                  <div className="text-right">Precio (Bs)</div>
                  <div className="text-right">Total</div>
                  <div className="text-center"></div>
                </div>
                <div className="flex-1 overflow-y-auto p-1 space-y-1">
                  {state.carrito.map((item, i) => {
                    const prod = state.productos.find(p => p.id === item.productoId);
                    return (
                      <div key={i} className="grid grid-cols-[1fr_80px_70px_35px_80px_80px_80px_35px] gap-1 items-center px-3 py-3 bg-white border-b border-black/5 text-ink">
                        <div className="truncate font-black text-xs uppercase leading-tight">
                          {item.nombre}
                          {item.esFraccion && (
                            <span className="ml-2 text-[8px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-black uppercase">Fracción</span>
                          )}
                        </div>
                        <div className="flex justify-center">
                          <input
                            type="number"
                            step="any"
                            min="0"
                            className="w-16 h-7 text-center font-black text-xs bg-surface-soft border border-line/30 rounded focus:ring-2 focus:ring-[#D4A017] focus:outline-none"
                            value={item.cantidad}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val) && val >= 0) {
                                handleQtyChange(i, val);
                              }
                            }}
                            onBlur={(e) => {
                              const val = parseFloat(e.target.value);
                              if (isNaN(val) || val < 0) {
                                handleQtyChange(i, 0);
                              }
                            }}
                          />
                        </div>
                        <div className="text-center text-[10px] font-black uppercase">{prod?.cantidad || '-'}</div>
                        <div className="flex justify-center">
                          <button 
                            onClick={() => prod && setPriceSelectorItem({ index: i, product: prod })}
                            className="text-brand-gold hover:text-brand-gold-deep transition-colors p-1 bg-brand-gold-soft/20 rounded-md"
                            title="Cambiar Precio (Alternativos)"
                          >
                            <Tag className="w-4 h-4" />
                          </button>
                        </div>
                        <div className="text-right text-xs font-black">{Utils.fmtUSD(item.precioUnitUSD)}</div>
                        <div className="text-right text-xs font-black">{Utils.fmtBS(item.precioUnitUSD * state.tasa)}</div>
                        <div className="text-right text-sm font-black">{Utils.fmtUSD(item.subtotalUSD)}</div>
                        <div className="flex justify-center">
                          <button onClick={() => updateQty(i, -item.cantidad)} className="text-ink/20 hover:text-red-600">
                            <Trash2 className="w-4 h-4"/>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="p-4 bg-ink border-t border-line/10 flex items-center justify-between rounded-b-lg gap-6">
                  <div className="space-y-0 shrink-0">
                    <label className="text-white/60 text-[8px] font-black uppercase block tracking-widest mb-1">TOTAL FACTURA</label>
                    <div className="text-4xl font-black text-brand-gold leading-none">{Utils.fmtUSD(subtotalUSD)}</div>
                  </div>
                  <div className="flex-1 flex justify-end items-center pr-4">
                    <div className="text-4xl font-black text-white">{Utils.fmtBS(totalBS)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {isFullScreen && (
                      <button 
                        onClick={() => setIsFullScreen(false)} 
                        className="w-14 h-14 bg-white/10 border-2 border-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/20 transition-all transform hover:scale-105"
                        title="Minimizar (ESC)"
                      >
                        <Minimize2 className="w-6 h-6" />
                      </button>
                    )}
                    <button 
                      onClick={() => saldoRestanteUSD <= 0.01 && state.carrito.length > 0 ? ejecutarVenta() : setShowMultiModal(true)} 
                      disabled={state.carrito.length === 0 || isProcessing} 
                      className="w-14 h-14 bg-[#c8952e] text-black rounded-full shadow-lg flex items-center justify-center hover:bg-[#d9a540] transition-all transform hover:scale-105 active:scale-95 disabled:opacity-20 shrink-0"
                    >
                      {isProcessing ? <Loader2 className="w-8 h-8 animate-spin" /> : (saldoRestanteUSD <= 0.01 && state.carrito.length > 0 ? <Check className="w-8 h-8" /> : <Wallet className="w-8 h-8" />)}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : view === 'history' ? (
        <div className="card flex-1 bg-white flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 duration-300 rounded-xl">
          <div className="card-head px-6 py-4 bg-ink border-b border-white/10 flex justify-between items-center">
            <h3 className="text-white font-black uppercase italic tracking-tighter flex items-center gap-2 text-xs">
              <History className="w-5 h-5 text-brand-gold" /> HISTORIAL TERMINAL: {currentTerminal?.nombre || 'S/T'}
            </h3>
            <button onClick={() => setView('pos')} className="btn btn-sm bg-white text-ink hover:bg-surface-soft flex items-center gap-2 font-black uppercase text-[10px] rounded-lg border-none px-4">
              <ArrowLeft className="w-3.5 h-3.5"/> Volver al POS
            </button>
          </div>
          <div className="p-3 bg-surface-soft border-b border-line flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase text-ink/50 mr-2">Filtrar por:</span>
            <button 
              onClick={() => setHistoryDateFilter('today')} 
              className={`px-3 py-1 rounded-md text-[10px] font-black uppercase transition-all ${historyDateFilter === 'today' ? 'bg-brand-gold text-ink' : 'bg-white text-ink/50 border border-line'}`}
            >
              Hoy
            </button>
            <button 
              onClick={() => setHistoryDateFilter('yesterday')} 
              className={`px-3 py-1 rounded-md text-[10px] font-black uppercase transition-all ${historyDateFilter === 'yesterday' ? 'bg-brand-gold text-ink' : 'bg-white text-ink/50 border border-line'}`}
            >
              Ayer
            </button>
            <button 
              onClick={() => setHistoryDateFilter('month')} 
              className={`px-3 py-1 rounded-md text-[10px] font-black uppercase transition-all ${historyDateFilter === 'month' ? 'bg-brand-gold text-ink' : 'bg-white text-ink/50 border border-line'}`}
            >
              Mes
            </button>
            <button 
              onClick={() => setHistoryDateFilter('custom')} 
              className={`px-3 py-1 rounded-md text-[10px] font-black uppercase transition-all ${historyDateFilter === 'custom' ? 'bg-brand-gold text-ink' : 'bg-white text-ink/50 border border-line'}`}
            >
              Periodo
            </button>
            {historyDateFilter === 'custom' && (
              <div className="flex items-center gap-2 ml-2">
                <input 
                  type="date" 
                  className="form-input h-8 text-xs font-bold bg-white border-line"
                  value={historyDateFrom}
                  onChange={e => setHistoryDateFrom(e.target.value)}
                />
                <span className="text-xs font-black text-ink/50">–</span>
                <input 
                  type="date" 
                  className="form-input h-8 text-xs font-bold bg-white border-line"
                  value={historyDateTo}
                  onChange={e => setHistoryDateTo(e.target.value)}
                />
              </div>
            )}
            <span className="text-[10px] font-black text-ink/40 ml-auto">
              {filteredHistory.length} registros
            </span>
          </div>

          <div className="table-wrap flex-1 overflow-y-auto">
            <table>
              <thead>
                <tr>
                  <th>Recibo</th>
                  <th>Hora</th>
                  <th>Terminal</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th className="text-right">Monto USD</th>
                  <th>Método</th>
                  <th className="text-center">Estado</th>
                  <th className="text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {paginatedHistory.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-20 text-ink/20 font-black italic uppercase">No hay ventas en este período</td></tr>
                ) : (
                  paginatedHistory.sort((a,b) => b.fecha.localeCompare(a.fecha)).map(v => (
                    <tr key={v.id} className="border-b border-line/40 hover:bg-surface-warm/20">
                      <td className="text-ink font-black text-xs mono">{v.id}</td>
                      <td className="text-ink font-bold text-xs">{v.fecha.split('T')[1]?.slice(0, 5)}</td>
                      <td className="text-ink font-black text-[10px] uppercase">{v.terminalName || state.terminales.find(t => t.id === v.terminalId)?.nombre || '-'}</td>
                      <td className="text-ink font-black text-xs uppercase truncate max-w-[150px]">{v.cliente}</td>
                      <td className="text-ink font-black text-[9px] uppercase">
                        <span className={`badge ${v.type === 'COBRO DEUDA' ? 'badge-info' : 'badge-neutral'}`}>{v.type || 'VENTA'}</span>
                      </td>
                      <td className="text-brand-gold-deep font-black text-xs text-right">{Utils.fmtUSD(v.totalUSD)}</td>
                      <td className="text-ink font-bold text-[10px] uppercase">{Utils.metodoLabel(v.metodoPago)}</td>
                      <td className="text-center">
                        <span className={`badge ${v.estado === 'pendiente' ? 'badge-warn' : (v.estado === 'anulada' ? 'badge-err' : 'badge-ok')} font-black text-[9px] uppercase`}>{v.estado}</span>
                      </td>
                      <td className="text-center">
                        <button 
                          onClick={() => setShowDetails(v)} 
                          className="w-8 h-8 rounded-full flex items-center justify-center text-status-info hover:bg-status-info/10 transition-colors"
                          title="Ver detalle completo"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="p-3 bg-surface-soft border-t border-line flex justify-between items-center">
              <div className="flex gap-2">
                <button 
                  onClick={() => setHistoryPage(p => Math.max(1, p - 1))} 
                  disabled={historyPage === 1}
                  className="px-4 py-1.5 rounded-md text-[10px] font-black uppercase bg-white border border-line disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-gold-soft transition-colors"
                >
                  Anterior
                </button>
                <button 
                  onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))} 
                  disabled={historyPage === totalPages}
                  className="px-4 py-1.5 rounded-md text-[10px] font-black uppercase bg-white border border-line disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-gold-soft transition-colors"
                >
                  Siguiente
                </button>
              </div>
              <span className="text-[10px] font-black text-ink/60">
                Página {historyPage} de {totalPages}
              </span>
            </div>
          )}
        </div>
      ) : view === 'credits' ? (
        <div className="card flex-1 bg-white flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 duration-300 rounded-xl">
          <div className="card-head px-6 py-4 bg-ink border-b border-white/10 flex justify-between items-center">
            <h3 className="text-white font-black uppercase italic tracking-tighter flex items-center gap-2 text-xs">
              <ClipboardList className="w-5 h-5 text-brand-gold" /> CONSULTA CRÉDITOS Y COBRANZA (GLOBAL)
            </h3>
            <button onClick={() => setView('pos')} className="btn btn-sm bg-white text-ink hover:bg-surface-soft flex items-center gap-2 font-black uppercase text-[10px] rounded-lg border-none px-4">
              <ArrowLeft className="w-3.5 h-3.5"/> Volver al POS
            </button>
          </div>
          <div className="table-wrap flex-1 overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="px-6 py-3"></th>
                  <th className="text-ink font-black text-[10px] uppercase">Cliente / Identificación</th>
                  <th className="text-ink font-black text-[10px] uppercase text-right">Documentos</th>
                  <th className="text-ink font-black text-[10px] uppercase text-right">Saldo USD</th>
                  <th className="text-ink font-black text-[10px] uppercase text-right">Saldo BS</th>
                  <th className="text-ink font-black text-[10px] uppercase text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groupedCredits).length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-20 text-ink font-black uppercase italic">No hay deudas registradas</td></tr>
                ) : (
                  Object.entries(groupedCredits).map(([clientName, group]) => (
                    <React.Fragment key={clientName}>
                      <tr className="border-b border-line hover:bg-surface-warm/20 transition-colors">
                        <td className="px-6 py-4">
                           <button onClick={() => setExpandedClient(expandedClient === clientName ? null : clientName)} className="text-brand-gold hover:scale-110 transition-transform">
                             {expandedClient === clientName ? <ChevronUp /> : <ChevronDown />}
                           </button>
                        </td>
                        <td className="py-4"><div className="text-ink font-black text-sm uppercase">{clientName}</div></td>
                        <td className="text-right py-4 font-black text-ink">{group.debts.length} Facturas</td>
                        <td className="text-right py-4 font-black text-status-info text-base">{Utils.fmtUSD(group.totalUSD)}</td>
                        <td className="text-right py-4 font-black text-ink">{Utils.fmtBS(group.totalUSD * state.tasa)}</td>
                        <td className="text-center py-4">
                          <button onClick={() => setShowClientHistory(clientName)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md">
                            <Eye className="w-5 h-5" />
                          </button>
                        </td>
                      </tr>
                      {expandedClient === clientName && (
                        <tr className="bg-surface-soft/40 animate-in slide-in-from-top-1 duration-200">
                           <td colSpan={6} className="px-12 py-4">
                              <div className="card border-line bg-white shadow-inner rounded-xl overflow-hidden">
                                 <table className="w-full">
                                    <thead className="bg-ink/5">
                                      <tr>
                                        <th className="text-[9px] font-black uppercase p-2 text-left">Emisión</th>
                                        <th className="text-[9px] font-black uppercase p-2 text-left">Vencimiento</th>
                                        <th className="text-[9px] font-black uppercase p-2 text-right">Saldo USD</th>
                                        <th className="text-[9px] font-black uppercase p-2 text-center">Acciones</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.debts.map(d => (
                                        <tr key={d.id} className="border-b border-line/20">
                                          <td className="text-[10px] font-black p-2">{Utils.fmtFecha(d.fecha)}</td>
                                          <td className={`text-[10px] font-black p-2 ${d.fechaVencimiento < Utils.hoy() ? 'text-status-danger' : 'text-ink'}`}>
                                            {d.fechaVencimiento === '2099-12-31' ? 'ABIERTA' : Utils.fmtFecha(d.fechaVencimiento)}
                                          </td>
                                          <td className="text-[10px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                                          <td className="p-2 text-center">
                                            <div className="flex justify-center gap-2">
                                              <button onClick={() => setShowDetails(d)} className="w-8 h-8 rounded-full flex items-center justify-center text-status-success hover:bg-status-success/10">
                                                <Eye className="w-4 h-4"/>
                                              </button>
                                              <button onClick={() => { setShowAbonoModal(d); }} className="btn btn-sm btn-primary h-7 px-3 text-[8px] uppercase">
                                                Abonar
                                              </button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                 </table>
                              </div>
                           </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ReturnsModule state={state} updateState={updateState} onBackToPOS={() => setView('pos')} terminalId={currentTerminal?.id} />
      )}

      {/* ===== MODALES ===== */}
      {priceSelectorItem && (
        <div className="modal show" style={{ zIndex: 120 }}>
          <div className="modal-bg" onClick={() => setPriceSelectorItem(null)}></div>
          <div className="modal-box max-w-sm bg-white border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-3 px-5 border-b border-line bg-ink text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                <Tag className="w-4 h-4 text-brand-gold" /> Selección de Tarifa
              </h3>
              <button onClick={() => setPriceSelectorItem(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="modal-body p-6 space-y-4">
               <p className="text-[10px] font-black uppercase text-ink/40 text-center tracking-tighter">{priceSelectorItem.product.nombre}</p>
               <div className="grid grid-cols-1 gap-2">
                  <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioUSD)} className="flex justify-between items-center p-4 bg-surface-soft border border-line rounded-xl hover:border-brand-gold transition-all group">
                    <span className="text-xs font-black text-ink uppercase">Precio Estándar</span>
                    <span className="text-sm font-black text-ink group-hover:text-brand-gold-deep">{Utils.fmtUSD(priceSelectorItem.product.precioUSD)}</span>
                  </button>
                  
                  {priceSelectorItem.product.precioMayorUSD && priceSelectorItem.product.precioMayorUSD > 0 && (
                    <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioMayorUSD!)} className="flex justify-between items-center p-4 bg-brand-gold-soft/20 border border-brand-gold/20 rounded-xl hover:border-brand-gold transition-all group">
                      <span className="text-xs font-black text-brand-gold-deep uppercase">Precio al Mayor</span>
                      <span className="text-sm font-black text-brand-gold-deep">{Utils.fmtUSD(priceSelectorItem.product.precioMayorUSD)}</span>
                    </button>
                  )}

                  {priceSelectorItem.product.precioOfertaUSD && priceSelectorItem.product.precioOfertaUSD > 0 && (
                    <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioOfertaUSD!)} className="flex justify-between items-center p-4 bg-status-success-soft/20 border border-status-success/20 rounded-xl hover:border-status-success transition-all group">
                      <span className="text-xs font-black text-status-success uppercase">Precio Oferta</span>
                      <span className="text-sm font-black text-status-success">{Utils.fmtUSD(priceSelectorItem.product.precioOfertaUSD)}</span>
                    </button>
                  )}

                  {priceSelectorItem.product.precioPromoUSD && priceSelectorItem.product.precioPromoUSD > 0 && (
                    <button onClick={() => handlePriceChange(priceSelectorItem.index, priceSelectorItem.product.precioPromoUSD!)} className="flex justify-between items-center p-4 bg-status-info-soft/20 border border-status-info/20 rounded-xl hover:border-status-info transition-all group">
                      <span className="text-xs font-black text-status-info uppercase">Precio Promoción</span>
                      <span className="text-sm font-black text-status-info">{Utils.fmtUSD(priceSelectorItem.product.precioPromoUSD)}</span>
                    </button>
                  )}
               </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL VENTA FRACCIONADA (CORREGIDO) ===== */}
      {showFraccionSelector && (
        <div className="modal show" style={{ zIndex: 200 }}>
          <div className="modal-bg" onClick={() => {
            setShowFraccionSelector(null);
            setMontoFraccionBS(0);
            setMlCalculados(0);
          }}></div>
          <div className="modal-box max-w-md bg-white border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-3 px-5 border-b border-line bg-ink text-white flex justify-between items-center">
              <h3 className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                <FlaskConical className="w-4 h-4 text-brand-gold" /> Venta Fraccionada
              </h3>
              <button onClick={() => {
                setShowFraccionSelector(null);
                setMontoFraccionBS(0);
                setMlCalculados(0);
              }}><X className="w-4 h-4" /></button>
            </div>
            <div className="modal-body p-6 space-y-4">
              <div className="text-center">
                <p className="text-lg font-black text-ink uppercase">{showFraccionSelector.producto.nombre}</p>
                <p className="text-[10px] text-ink/40">
                  Stock: {showFraccionSelector.producto.stockML || 0} ml
                  {showFraccionSelector.producto.volumenTotalML && (
                    <span className="block text-[9px]">
                      ({Math.floor((showFraccionSelector.producto.stockML || 0) / showFraccionSelector.producto.volumenTotalML)} botella(s) completas + 
                      {(showFraccionSelector.producto.stockML || 0) % showFraccionSelector.producto.volumenTotalML} ml)
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-ink/40">
                  Precio por ml: {Utils.fmtUSD(showFraccionSelector.producto.precioUSD || 0)}
                </p>
              </div>
              
              <div className="space-y-4">
                {/* Input para monto en Bs. */}
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Monto a Pagar (Bs.)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-3 text-ink font-black">Bs.</span>
                    <input
                      type="number"
                      className="form-input pl-12 h-12 text-xl font-black text-brand-gold-deep bg-white"
                      value={montoFraccionBS || ''}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        setMontoFraccionBS(val);
                        if (showFraccionSelector) {
                          const ml = calcularFraccion(val, showFraccionSelector.producto);
                          setMlCalculados(ml);
                        }
                      }}
                      min={50}
                      step={50}
                      autoFocus
                    />
                  </div>
                  <div className="flex justify-between text-[8px] font-black">
                    <span className="text-ink/40">Mínimo: 50 ml</span>
                    <span className="text-ink/40">
                      Máximo: {Utils.fmtBS(((showFraccionSelector.producto.stockML || 0) * (showFraccionSelector.producto.precioUSD || 0)) * state.tasa)}
                    </span>
                  </div>
                </div>

                {/* Selector rápido de ml predefinidos */}
                <div className="flex flex-wrap gap-2 justify-center">
                  {[50, 100, 200, 300, 500, 750].map(ml => {
                    const producto = showFraccionSelector.producto;
                    const precioUSD = (producto.precioUSD || 0) * ml;
                    const precioBS = precioUSD * state.tasa;
                    return (
                      <button
                        key={ml}
                        onClick={() => {
                          setMontoFraccionBS(precioBS);
                          setMlCalculados(ml);
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all ${
                          Math.round(mlCalculados) === ml 
                            ? 'bg-brand-gold text-black border-brand-gold' 
                            : 'bg-white text-ink/60 border-line hover:border-brand-gold'
                        }`}
                      >
                        {ml}ml
                      </button>
                    );
                  })}
                </div>

                {/* Resumen */}
                <div className="bg-surface-soft p-4 rounded-xl border border-line">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-[8px] font-black uppercase text-ink/40">Volumen</p>
                      <p className="text-xl font-black text-ink">{mlCalculados.toFixed(0)} ml</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black uppercase text-ink/40">Total Bs.</p>
                      <p className="text-xl font-black text-brand-gold-deep">{Utils.fmtBS(montoFraccionBS)}</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-black uppercase text-ink/40">Total USD</p>
                      <p className="text-xl font-black text-ink">{Utils.fmtUSD(montoFraccionBS / state.tasa)}</p>
                    </div>
                  </div>
                  {showFraccionSelector.producto.precioUSD && (
                    <div className="mt-2 pt-2 border-t border-line/30 text-center">
                      <span className="text-[8px] font-black text-ink/40">Precio por ml: </span>
                      <span className="text-[10px] font-black text-brand-gold-deep">
                        {Utils.fmtUSD(showFraccionSelector.producto.precioUSD)} ≈ {Utils.fmtBS(showFraccionSelector.producto.precioUSD * state.tasa)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line flex justify-end gap-3">
              <button 
                onClick={() => {
                  setShowFraccionSelector(null);
                  setMontoFraccionBS(0);
                  setMlCalculados(0);
                }}
                className="btn btn-secondary font-black uppercase text-[10px]"
              >
                Cancelar
              </button>
              <button 
                onClick={agregarFraccion}
                disabled={montoFraccionBS <= 0 || mlCalculados <= 0}
                className="btn btn-primary font-black uppercase text-[10px] flex items-center gap-2"
              >
                <ShoppingCart className="w-4 h-4" />
                Agregar al Carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceiptModal && (
        <ReceiptModal 
          isOpen={showReceiptModal} 
          onClose={() => { 
            setShowReceiptModal(false); 
            setLastProcessedSale(null); 
          }} 
          saleData={lastProcessedSale} 
          type="SALE" 
        />
      )}
      
      {showReportType && reportSnapshot && (
        <ReceiptModal 
          isOpen={!!showReportType} 
          onClose={() => { 
            if (showReportType === 'REPORT_Z') ejecutarCierreZ(); 
            setShowReportType(null); 
          }} 
          reportData={reportSnapshot} 
          type={showReportType} 
        />
      )}
      
      {showMultiModal && (
        <FloatingPaymentModal 
          total={totalBS} 
          totalCents={Math.round(totalBS * 100)} 
          exchangeRate={state.tasa} 
          onClose={() => setShowMultiModal(false)} 
          onConfirm={(data) => { 
            ejecutarVenta(data.payments.map(p => ({ 
              metodo: p.method as PaymentMethod, 
              montoUSD: p.usdAmount || (p.amount / state.tasa), 
              montoBS: p.amount 
            }))); 
            setShowMultiModal(false); 
          }} 
        />
      )}
      
      {showAbonoModal && (
        <FloatingPaymentModal 
          total={showAbonoModal.saldoUSD * state.tasa} 
          totalCents={Math.round(showAbonoModal.saldoUSD * state.tasa * 100)} 
          exchangeRate={state.tasa} 
          onClose={() => setShowAbonoModal(null)} 
          allowPartial={true} 
          onConfirm={(data) => { 
            ejecutarAbono(data.payments.map(p => ({ 
              metodo: p.method as PaymentMethod, 
              montoUSD: p.usdAmount || (p.amount / state.tasa), 
              montoBS: p.amount 
            }))); 
          }} 
        />
      )}

      {showDetails && (
        <div className="modal show" style={{ zIndex: 110 }}>
          <div className="modal-bg" onClick={() => setShowDetails(null)}></div>
          <div className="modal-box max-w-[600px] bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Receipt className="w-5 h-5 text-brand-gold" /> DETALLE DE TRANSACCIÓN: {showDetails.id}
              </h3>
              <button onClick={() => setShowDetails(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-6 space-y-6 max-h-[75vh] overflow-y-auto bg-white">
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-3 bg-surface-soft rounded-lg border border-line">
                    <label className="text-[8px] font-black uppercase text-ink block mb-1">Monto Total</label>
                    <p className="text-lg font-black text-ink">{Utils.fmtUSD(showDetails.totalUSD || showDetails.montoUSD || 0)}</p>
                 </div>
                 <div className="p-3 bg-brand-gold-soft border border-brand-gold/20 rounded-lg">
                    <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Cliente</label>
                    <p className="text-sm font-black text-brand-gold-deep uppercase">{showDetails.cliente || showDetails.cliente || 'N/A'}</p>
                 </div>
              </div>

              {(() => {
                const sale = state.ventas.find(v => v.id === showDetails.ventaId || v.id === showDetails.id);
                if (!sale) return null;
                return (
                  <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                       <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em]">DETALLE DE COMPRA</h4>
                       <span className="text-[9px] font-black text-ink uppercase">{Utils.fmtFecha(sale.fecha)}</span>
                    </div>
                    <div className="bg-surface-soft/50 rounded-lg overflow-hidden border border-line/30">
                       <table className="w-full">
                          <thead>
                            <tr className="bg-ink/5">
                               <th className="text-[8px] font-black uppercase p-2 text-left">Cant</th>
                               <th className="text-[8px] font-black uppercase p-2 text-left">Descripción</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right">P. Unit</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sale.items.map((it: any, idx: number) => (
                              <tr key={idx} className="border-b border-line/20">
                                 <td className="text-[9px] font-black p-2">{it.cantidad}</td>
                                 <td className="text-[9px] font-black uppercase p-2 truncate max-w-[180px]">{it.nombre}</td>
                                 <td className="text-[9px] font-black p-2 text-right">{Utils.fmtUSD(it.precioUnitUSD)}</td>
                                 <td className="text-[9px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD)}</td>
                              </tr>
                            ))}
                          </tbody>
                       </table>
                    </div>

                    {sale.payments && sale.payments.length > 0 && (
                      <div className="space-y-2">
                        <h5 className="text-[9px] font-black uppercase text-ink/60 border-b border-line/30 pb-1">Métodos de Pago</h5>
                        <div className="space-y-1">
                          {sale.payments.map((p: any, idx: number) => (
                            <div key={idx} className="flex justify-between items-center bg-white rounded-lg border border-line/20 px-3 py-2">
                              <span className="text-[10px] font-black uppercase text-ink">{Utils.metodoLabel(p.metodo)}</span>
                              <span className="text-[10px] font-black text-brand-gold-deep">{Utils.fmtUSD(p.montoUSD)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {showDetails.historialPagos && (
                <div className="space-y-3">
                   <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em] border-b border-line pb-2">CRONOLOGÍA DE ABONOS</h4>
                   <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                      {showDetails.historialPagos.length === 0 ? (
                        <div className="py-10 text-center text-ink font-black uppercase italic text-[10px]">No se han registrado abonos aún</div>
                      ) : (
                        showDetails.historialPagos.map((p: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center p-3 bg-surface-soft border border-line rounded-lg">
                             <div className="space-y-0.5">
                                <p className="text-[10px] font-black text-ink uppercase">{Utils.fmtFecha(p.fecha)}</p>
                                <p className="text-[8px] font-black text-ink mono">REF: {p.reciboId}</p>
                             </div>
                             <div className="text-right">
                                <p className="text-xs font-black text-status-success">+{Utils.fmtUSD(p.montoUSD)}</p>
                                <p className="text-[8px] font-black text-ink uppercase">{Utils.metodoLabel(p.metodo || 'otros')}</p>
                             </div>
                          </div>
                        ))
                      )}
                   </div>
                </div>
              )}
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowDetails(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {showClientHistory && (
        <div className="modal show" style={{ zIndex: 105 }}>
          <div className="modal-bg" onClick={() => setShowClientHistory(null)}></div>
          <div className={`modal-box max-w-4xl bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl transition-all ${showDetails ? 'blur-sm scale-95 opacity-40 pointer-events-none' : ''}`}>
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black uppercase italic tracking-tighter text-xs flex items-center gap-2">
                <Contact className="w-5 h-5 text-brand-gold" /> ESTADO DE CUENTA MAESTRO: {showClientHistory}
              </h3>
              <button onClick={() => setShowClientHistory(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-0 max-h-[70vh] overflow-y-auto bg-white">
               <div className="table-wrap">
                  <table className="w-full">
                    <thead className="bg-surface-soft sticky top-0 z-10">
                      <tr>
                        <th className="text-[9px] font-black uppercase p-4 text-left">Fecha</th>
                        <th className="text-[9px] font-black uppercase p-4 text-left">ID Documento</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right">Monto Total</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right">Abonado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right">Saldo Pend.</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center">Estado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center">Auditoría</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.cxc.filter(d => d.cliente === showClientHistory).sort((a,b) => b.fecha.localeCompare(a.fecha)).map(d => (
                        <tr key={d.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                          <td className="p-4 text-xs font-black">{Utils.fmtFecha(d.fecha)}</td>
                          <td className="p-4 text-xs font-black mono">{d.id}</td>
                          <td className="p-4 text-right text-xs font-black">{Utils.fmtUSD(d.montoUSD)}</td>
                          <td className="p-4 text-right text-xs font-black text-status-success">{Utils.fmtUSD(d.abonadoUSD)}</td>
                          <td className="p-4 text-right text-sm font-black text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                          <td className="p-4 text-center">
                            <span className={`badge ${d.estado === 'pagada' ? 'badge-ok' : (d.estado === 'parcial' ? 'badge-info' : 'badge-warn')} font-black text-[8px] uppercase px-3`}>
                              {d.estado}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                             <button onClick={() => setShowDetails(d)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md">
                               <Eye className="w-5 h-5"/>
                             </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowClientHistory(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">
                 Cerrar Historial
               </button>
            </div>
          </div>
        </div>
      )}

      <CreditModal
        isOpen={isCreditModalOpen}
        onClose={() => setIsCreditModalOpen(false)}
        onConfirm={handleCreditModalConfirm}
        totalAmount={subtotalUSD}
        {...({ 
          clients: state.clientes || [], 
          debts: state.cxc || [], 
          initialClientName: cliente 
        } as any)}
      />

      <CashSaleModal
        isOpen={showCashSaleModal}
        onClose={() => setShowCashSaleModal(false)}
        onConfirm={procesarVentaEfectivo}
        comisionEfectivo={state.comisionEfectivo || 5}
        tasaCambio={state.tasa}
      />
    </div>
  );
}