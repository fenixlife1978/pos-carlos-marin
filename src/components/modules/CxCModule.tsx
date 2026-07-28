'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { AppState, Debt, Customer } from '@/lib/types';
import { Utils, Store, Collections } from '@/lib/db-store';
import { 
  Plus, 
  X, 
  Save, 
  HandCoins, 
  Calendar, 
  CheckSquare, 
  Square, 
  Eye, 
  Trash2, 
  Clock, 
  ClipboardList, 
  Box, 
  FileText,
  ChevronDown,
  ChevronUp,
  User,
  Contact,
  Receipt,
  BookOpen,
  Hash,
  RefreshCw,
  Bell,
  AlertTriangle
} from 'lucide-react';
import { exportarPDFCxC } from '@/lib/pdf-generator';
import { useToast } from '@/hooks/use-toast';

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

function findCustomerByCedula(customers: Customer[], cedula: string): Customer | null {
  const raw = getRawCedula(cedula);
  return customers.find(c => getRawCedula(c.cedula) === raw) || null;
}

function findDebtsByCedula(deudas: Debt[], cedula: string): Debt[] {
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

export default function CxCModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const { toast } = useToast();
  const [showModal, setShowModal] = useState(false);
  const [showDetails, setShowDetails] = useState<any>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showClientHistory, setShowClientHistory] = useState<string | null>(null);
  const [filterEstado, setFilterEstado] = useState<'todos' | 'pendiente' | 'pagada' | 'parcial'>('todos');

  // ============================================================
  // ALERTAS DE VENCIMIENTO (24 HORAS)
  // ============================================================
  const [vencimientosProximos, setVencimientosProximos] = useState<Debt[]>([]);
  const [showVencimientoAlert, setShowVencimientoAlert] = useState(false);

  useEffect(() => {
    const checkVencimientos = () => {
      const now = new Date();
      const manana = new Date();
      manana.setDate(manana.getDate() + 1);
      manana.setHours(23, 59, 59, 999);

      const proximos = (state.cxc || []).filter(d => {
        if (d.estado === 'pagada') return false;
        if (d.fechaVencimiento === '2099-12-31') return false;
        const dueDate = new Date(d.fechaVencimiento + 'T23:59:59');
        return dueDate <= manana && dueDate >= now;
      });

      setVencimientosProximos(proximos);

      if (proximos.length > 0) {
        const lastAlert = localStorage.getItem('posven_cxc_vencimiento_alert');
        const unaHora = 60 * 60 * 1000;
        
        if (!lastAlert || (Date.now() - parseInt(lastAlert)) > unaHora) {
          setShowVencimientoAlert(true);
          localStorage.setItem('posven_cxc_vencimiento_alert', Date.now().toString());
        }
      }
    };

    checkVencimientos();
    const interval = setInterval(checkVencimientos, 60000);
    return () => clearInterval(interval);
  }, [state.cxc]);

  const [nuevaDeuda, setNuevaDeuda] = useState({
    cliente: '',
    tipoDoc: 'V',
    cedula: '',
    montoUSD: 0,
    fecha: Utils.hoy(),
    vencimiento: Utils.hoy(),
    sinVencimiento: false
  });

  const formatCedula = (value: string, type: string) => {
    if (type !== 'V' && type !== 'E') {
      return value.replace(/\D/g, '');
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 2) return digits;
    if (digits.length <= 5) return digits.slice(0, 2) + '.' + digits.slice(2);
    if (digits.length <= 8) return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5);
    return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5, 8);
  };

  const handleCedulaChange = (val: string) => {
    const formatted = formatCedula(val, nuevaDeuda.tipoDoc);
    setNuevaDeuda({ ...nuevaDeuda, cedula: formatted });
  };

  const handleTipoDocChange = (tipo: string) => {
    const cleanNumber = nuevaDeuda.cedula.replace(/\./g, '');
    const formatted = formatCedula(cleanNumber, tipo);
    setNuevaDeuda({ ...nuevaDeuda, tipoDoc: tipo, cedula: formatted });
  };

  const allCustomers: Customer[] = state.clientes || [];
  const todasLasDeudas = state.cxc || [];
  const pendientes = todasLasDeudas.filter((x: any) => x.estado !== 'pagada');
  const totalPendiente = pendientes.reduce((s: number, x: any) => s + x.saldoUSD, 0);

  // ===== AGRUPACIÓN POR CLIENTE =====
  const groupedCredits = useMemo(() => {
    const groups: Record<string, { 
      totalUSD: number; 
      debts: Debt[];
      customer: Customer | null;
      displayName: string;
      cedula: string;
    }> = {};

    allCustomers.forEach((customer: Customer) => {
      const raw = getRawCedula(customer.cedula);
      groups[raw] = {
        totalUSD: 0,
        debts: [],
        customer: customer,
        displayName: customer.name,
        cedula: customer.cedula
      };
    });

    todasLasDeudas.forEach((debt: Debt) => {
      const match = debt.cliente?.match(/^(.*?)\s*\[(.*?)\]$/);
      let raw = '';
      let nombreCliente = debt.cliente || 'DESCONOCIDO';
      
      if (match) {
        raw = getRawCedula(match[2]);
        nombreCliente = match[1].trim();
      } else {
        const clienteEncontrado = allCustomers.find(c => c.name === debt.cliente);
        if (clienteEncontrado) {
          raw = getRawCedula(clienteEncontrado.cedula);
        } else {
          const key = `temp_${debt.id}`;
          groups[key] = {
            totalUSD: 0,
            debts: [],
            customer: null,
            displayName: debt.cliente || 'DESCONOCIDO',
            cedula: 'SIN-CEDULA'
          };
          raw = key;
        }
      }

      if (raw && groups[raw]) {
        groups[raw].debts.push(debt);
        if (debt.estado !== 'pagada') {
          groups[raw].totalUSD += debt.saldoUSD;
        }
      } else if (raw) {
        const tipo = extractDocType(match ? match[2] : '');
        const cedulaNormalizada = normalizeCedula(match ? match[2] : '', tipo);
        groups[raw] = {
          totalUSD: debt.estado !== 'pagada' ? debt.saldoUSD : 0,
          debts: [debt],
          customer: null,
          displayName: match ? match[1].trim() : debt.cliente || 'DESCONOCIDO',
          cedula: cedulaNormalizada || 'SIN-CEDULA'
        };
      }
    });

    Object.keys(groups).forEach(key => {
      groups[key].debts.sort((a: Debt, b: Debt) => a.fecha.localeCompare(b.fecha));
    });

    if (filterEstado !== 'todos') {
      const filteredGroups: Record<string, any> = {};
      Object.keys(groups).forEach(key => {
        const group = groups[key];
        const filteredDebts = group.debts.filter((d: Debt) => d.estado === filterEstado);
        if (filteredDebts.length > 0) {
          filteredGroups[key] = {
            ...group,
            debts: filteredDebts,
            totalUSD: filteredDebts.reduce((s: number, d: Debt) => s + (d.estado !== 'pagada' ? d.saldoUSD : 0), 0)
          };
        } else if (group.debts.length === 0 && group.customer) {
          filteredGroups[key] = group;
        }
      });
      return filteredGroups;
    }

    return groups;
  }, [todasLasDeudas, allCustomers, filterEstado]);

  // ===== SINCORNIZAR CLIENTES DESDE CXC (usando Collections) =====
  const syncCustomersFromCxC = async () => {
    const clientesExistentes = new Map(allCustomers.map(c => [getRawCedula(c.cedula), c]));
    const clientesFromCxC: Map<string, { name: string, cedula: string }> = new Map();
    
    todasLasDeudas.forEach((d: Debt) => {
      if (!d.cliente) return;
      const match = d.cliente.match(/^(.*?)\s*\[(.*?)\]$/);
      if (match) {
        const raw = getRawCedula(match[2]);
        if (!clientesExistentes.has(raw) && !clientesFromCxC.has(raw)) {
          const tipo = extractDocType(match[2]);
          const cedulaNormalizada = normalizeCedula(match[2], tipo);
          clientesFromCxC.set(raw, {
            name: match[1].trim(),
            cedula: cedulaNormalizada
          });
        }
      }
    });

    const nuevosClientes: Customer[] = [];
    clientesFromCxC.forEach((data, raw) => {
      const nuevoCliente: Customer = {
        id: `CUS-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        name: data.name,
        cedula: data.cedula,
        address: 'Sin dirección',
        phone: 'Sin teléfono',
        debt: 0
      };
      nuevosClientes.push(nuevoCliente);
      Collections.set('clientes', nuevoCliente.id, nuevoCliente);
    });

    if (nuevosClientes.length > 0) {
      toast({ 
        title: "Clientes sincronizados", 
        description: `Se agregaron ${nuevosClientes.length} clientes desde las deudas.` 
      });
    } else {
      toast({ 
        title: "Sin cambios", 
        description: "Todos los clientes ya están sincronizados." 
      });
    }
  };

  useEffect(() => {
    syncCustomersFromCxC();
  }, []);

  // ===== ELIMINAR CLIENTE Y TODAS SUS DEUDAS (con Collections) =====
  const eliminarCliente = async (clientName: string) => {
    const cliente = allCustomers.find(c => c.name === clientName);
    if (!cliente) {
      toast({ 
        variant: "destructive",
        title: "Cliente no encontrado", 
        description: `No se encontró el cliente "${clientName}".` 
      });
      return;
    }

    const rawCedula = getRawCedula(cliente.cedula);

    const deudasPendientes = findDebtsByCedula(todasLasDeudas, rawCedula).filter(d => d.estado !== 'pagada');
    
    if (deudasPendientes.length > 0) {
      toast({ 
        variant: "destructive",
        title: "No se puede eliminar", 
        description: `El cliente "${clientName}" tiene ${deudasPendientes.length} deuda(s) pendiente(s).` 
      });
      return;
    }

    const tieneDeudas = findDebtsByCedula(todasLasDeudas, rawCedula).length > 0;
    let mensajeConfirmacion = `¿Está seguro de eliminar permanentemente al cliente "${clientName}"`;
    if (tieneDeudas) {
      mensajeConfirmacion += " y todo su historial de deudas (pagadas)";
    }
    mensajeConfirmacion += "?";

    if (!confirm(mensajeConfirmacion)) return;

    await Collections.delete('clientes', cliente.id);
    
    const deudasAEliminar = todasLasDeudas.filter((d: Debt) => {
      const match = d.cliente?.match(/^(.*?)\s*\[(.*?)\]$/);
      if (match) {
        return getRawCedula(match[2]) === rawCedula;
      }
      return d.cliente === clientName || d.cliente === `${clientName} [${cliente.cedula}]`;
    });

    for (const deuda of deudasAEliminar) {
      await Collections.delete('cxc', deuda.id);
    }
    
    toast({ 
      title: "Cliente eliminado", 
      description: `El cliente "${clientName}" y su historial han sido eliminados permanentemente.` 
    });
  };

  // ===== GUARDAR DEUDA DIRECTA (con Collections) =====
  const guardarDeudaDirecta = async () => {
    if (!nuevaDeuda.cliente || !nuevaDeuda.cedula || nuevaDeuda.montoUSD <= 0) {
      alert('Por favor ingrese el cliente, su cédula y un monto válido.');
      return;
    }

    const cleanNumber = nuevaDeuda.cedula.replace(/\./g, '');
    const rawDoc = `${nuevaDeuda.tipoDoc}-${cleanNumber}`;
    const normalizedCedula = normalizeCedula(rawDoc);
    const raw = getRawCedula(normalizedCedula);

    let cliente = findCustomerByCedula(allCustomers, normalizedCedula);

    if (!cliente) {
      const deudasCliente = findDebtsByCedula(todasLasDeudas, normalizedCedula);
      if (deudasCliente.length > 0) {
        const match = deudasCliente[0].cliente?.match(/^(.*?)\s*\[(.*?)\]$/);
        if (match) {
          const nombre = match[1].trim();
          cliente = {
            id: `CUS-${Date.now()}`,
            name: nombre,
            cedula: normalizedCedula,
            address: 'Sin dirección',
            phone: 'Sin teléfono',
            debt: 0
          };
          await Collections.set('clientes', cliente.id, cliente);
        }
      }
    }

    if (!cliente) {
      cliente = {
        id: `CUS-${Date.now()}`,
        name: nuevaDeuda.cliente,
        cedula: normalizedCedula,
        address: 'Sin dirección',
        phone: 'Sin teléfono',
        debt: nuevaDeuda.montoUSD
      };
      await Collections.set('clientes', cliente.id, cliente);
    } else {
      const clienteActualizado = { 
        ...cliente, 
        debt: (cliente.debt || 0) + nuevaDeuda.montoUSD 
      };
      await Collections.set('clientes', cliente.id, clienteActualizado);
    }

    const nombreCliente = cliente.name;
    const cedulaCliente = cliente.cedula;
    const nombreFull = `${nombreCliente} [${cedulaCliente}]`;

    const nuevaEntrada: Debt = {
      id: 'DEU-' + Store.uid().toUpperCase().slice(0, 6),
      fecha: nuevaDeuda.fecha,
      fechaVencimiento: nuevaDeuda.sinVencimiento ? '2099-12-31' : nuevaDeuda.vencimiento,
      cliente: nombreFull,
      montoUSD: nuevaDeuda.montoUSD,
      abonadoUSD: 0,
      saldoUSD: nuevaDeuda.montoUSD,
      estado: 'pendiente' as 'pendiente',
      historialPagos: []
    };
    
    await Collections.set('cxc', nuevaEntrada.id, nuevaEntrada);
    
    setShowModal(false);
    setNuevaDeuda({ cliente: '', tipoDoc: 'V', cedula: '', montoUSD: 0, fecha: Utils.hoy(), vencimiento: Utils.hoy(), sinVencimiento: false });
    
    toast({ 
      title: "Deuda registrada", 
      description: `Se cargó ${Utils.fmtUSD(nuevaDeuda.montoUSD)} a ${nombreCliente}.` 
    });
  };

  const eliminarDeuda = async (deuda: any) => {
    if (!confirm(`¿Seguro que desea eliminar el registro ${deuda.id}? Esta acción no se puede deshacer.`)) return;
    
    await Collections.delete('cxc', deuda.id);
    
    const match = deuda.cliente?.match(/^(.*?)\s*\[(.*?)\]$/);
    if (match) {
      const raw = getRawCedula(match[2]);
      const cliente = findCustomerByCedula(allCustomers, match[2]);
      if (cliente) {
        const clienteActualizado = { 
          ...cliente, 
          debt: Math.max(0, (cliente.debt || 0) - deuda.saldoUSD) 
        };
        await Collections.set('clientes', cliente.id, clienteActualizado);
      }
    }
  };

  const handleExportPDF = () => {
    exportarPDFCxC(pendientes, state.empresa, totalPendiente);
  };

  return (
    <div className="space-y-6">
      {/* ============================================================
        ALERTA DE VENCIMIENTO (24 HORAS)
      ============================================================ */}
      {showVencimientoAlert && vencimientosProximos.length > 0 && (
        <div className="modal show" style={{ zIndex: 9999 }}>
          <div className="modal-bg" onClick={() => setShowVencimientoAlert(false)} />
          <div className="modal-box max-w-lg bg-white border-2 border-status-danger/30 rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in duration-300">
            <div className="modal-head py-5 px-8 bg-status-danger border-b border-status-danger/20 flex justify-between items-center text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shadow-lg">
                  <AlertTriangle className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h3 className="font-black text-sm uppercase italic tracking-widest">⚠️ Vencimiento Próximo (CxC)</h3>
                  <p className="text-[9px] font-bold text-white/70 uppercase tracking-tighter">
                    {vencimientosProximos.length} factura(s) vencen en las próximas 24 horas
                  </p>
                </div>
              </div>
              <button onClick={() => setShowVencimientoAlert(false)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="modal-body p-6 space-y-4 bg-white max-h-[60vh] overflow-y-auto">
              {vencimientosProximos.map((d, idx) => {
                const diff = new Date(d.fechaVencimiento + 'T23:59:59').getTime() - Date.now();
                const horas = Math.ceil(diff / (1000 * 60 * 60));
                return (
                  <div key={idx} className="p-4 bg-status-danger-soft border border-status-danger/20 rounded-2xl flex items-center justify-between group hover:border-status-danger transition-all">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-ink uppercase">{d.cliente}</p>
                      <div className="flex items-center gap-2">
                        <span className="badge badge-neutral text-[8px] font-black uppercase">Ref: {d.id.slice(-6)}</span>
                        <span className="flex items-center gap-1 text-[9px] font-bold text-status-danger uppercase">
                          <Clock className="w-3 h-3" /> {horas <= 0 ? 'VENCE HOY' : `Vence en ${horas}h`}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-status-danger">{Utils.fmtUSD(d.saldoUSD)}</p>
                      <p className="text-[9px] font-bold text-ink/40 uppercase italic">Saldo Pendiente</p>
                    </div>
                  </div>
                );
              })}
              <div className="bg-ink/5 p-3 rounded-xl border border-line text-center">
                <p className="text-[8px] font-black text-ink/40 uppercase tracking-widest">
                  Este recordatorio se mostrará una vez por hora hasta que se liquiden las deudas.
                </p>
              </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line flex justify-end gap-3">
              <button 
                onClick={() => setShowVencimientoAlert(false)}
                className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md"
              >
                Entendido, lo revisaré
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl flex items-center gap-2">
            <HandCoins className="text-brand-gold w-7 h-7" /> COBRANZAS (GESTIÓN GLOBAL)
          </h2>
          <p className="text-[10px] text-ink font-black uppercase tracking-widest">Seguimiento de Cartera de Clientes y Morosidad</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {vencimientosProximos.length > 0 && (
            <button 
              onClick={() => setShowVencimientoAlert(true)}
              className="relative w-[38px] h-[38px] rounded-[10px] bg-white border border-line flex items-center justify-center text-ink hover:text-status-danger transition-colors shadow-sm"
            >
              <Bell className="w-4 h-4 text-status-danger animate-pulse" />
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-status-danger text-white rounded-full flex items-center justify-center text-[9px] font-black border-2 border-white">
                {vencimientosProximos.length}
              </span>
            </button>
          )}
          <button onClick={handleExportPDF} className="btn btn-secondary h-11 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-md">
            <FileText className="w-4 h-4" /> Reporte CxC
          </button>
          <button onClick={() => setShowModal(true)} className="btn btn-primary h-11 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-lg">
            <Plus className="w-4 h-4" /> Cargar Deuda Inicial
          </button>
        </div>
      </div>

      {/* FILTROS */}
      <div className="flex items-center gap-4 bg-white p-3 rounded-xl border border-line shadow-sm flex-wrap">
        <span className="text-[10px] font-black uppercase text-ink">Filtrar por estado:</span>
        <div className="flex gap-2 flex-wrap">
          {['todos', 'pendiente', 'parcial', 'pagada'].map(estado => (
            <button
              key={estado}
              onClick={() => setFilterEstado(estado as any)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${
                filterEstado === estado 
                  ? 'bg-brand-gold text-black shadow-md' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {estado === 'todos' ? 'Todos' : estado}
            </button>
          ))}
        </div>
        <button 
          onClick={syncCustomersFromCxC} 
          className="ml-auto px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-black hover:bg-blue-100 transition-all flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Sincronizar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="kpi bg-white border-line shadow-md p-6 rounded-2xl flex items-center gap-4">
           <div className="p-3 bg-ink text-brand-gold rounded-xl"><ClipboardList /></div>
           <div>
              <div className="text-ink text-[10px] font-black uppercase mb-0.5">Total Clientes</div>
              <div className="text-3xl font-black text-ink">{Object.keys(groupedCredits).length}</div>
           </div>
        </div>
        <div className="kpi bg-white border-line shadow-md p-6 rounded-2xl flex items-center gap-4">
           <div className="p-3 bg-ink text-brand-gold rounded-xl"><Clock /></div>
           <div>
              <div className="text-ink text-[10px] font-black uppercase mb-0.5">Clientes con Deuda</div>
              <div className="text-3xl font-black text-ink">
                {Object.keys(groupedCredits).filter(key => groupedCredits[key].totalUSD > 0).length}
              </div>
           </div>
        </div>
        <div className="kpi bg-white border-line shadow-md p-6 rounded-2xl border-l-[6px] border-l-status-danger">
          <div className="text-ink text-[10px] font-black uppercase mb-1">Total Por Cobrar (Cartera Activa)</div>
          <div className="text-4xl font-black text-status-danger">{Utils.fmtUSD(totalPendiente)}</div>
          <div className="text-ink text-sm font-black mt-1 italic">{Utils.fmtBS(totalPendiente * state.tasa)}</div>
        </div>
      </div>

      <div className="card shadow-xl border-line rounded-xl overflow-hidden bg-white">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex justify-between items-center">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-brand-gold" /> LISTADO CONSOLIDADO POR CLIENTE
          </h3>
          <span className="text-white/40 text-[10px] font-black uppercase">
            {Object.keys(groupedCredits).length} clientes totales
          </span>
        </div>
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-soft">
                <th className="px-6 py-3"></th>
                <th className="text-ink font-black text-[10px] uppercase">Cliente / Identificación</th>
                <th className="text-ink font-black text-[10px] uppercase text-right">Documentos</th>
                <th className="text-ink font-black text-[10px] uppercase text-right">Saldo USD</th>
                <th className="text-ink font-black text-[10px] uppercase text-right">Saldo BS</th>
                <th className="text-ink font-black text-[10px] uppercase text-center">Estado</th>
                <th className="text-ink font-black text-[10px] uppercase text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedCredits).length === 0 ? (
                <tr><td colSpan={7} className="text-center py-20 text-ink font-black uppercase italic">No hay clientes registrados</td></tr>
              ) : (
                Object.entries(groupedCredits).map(([key, group]) => {
                  const tieneDeudaPendiente = group.totalUSD > 0;
                  const tieneDeudas = group.debts.length > 0;
                  const displayName = group.displayName || group.customer?.name || 'CLIENTE SIN NOMBRE';
                  const cedula = group.cedula || group.customer?.cedula || 'SIN-CEDULA';
                  
                  return (
                    <React.Fragment key={key}>
                      <tr className={`border-b border-line hover:bg-surface-warm/20 transition-colors ${!tieneDeudaPendiente && tieneDeudas ? 'opacity-60' : ''}`}>
                        <td className="px-6 py-4">
                           {tieneDeudas ? (
                             <button onClick={() => setExpandedClient(expandedClient === key ? null : key)} className="text-brand-gold hover:scale-110 transition-transform">
                                {expandedClient === key ? <ChevronUp /> : <ChevronDown />}
                             </button>
                           ) : (
                             <span className="text-gray-300">-</span>
                           )}
                        </td>
                        <td className="py-4">
                           <div className="text-ink font-black text-sm uppercase">{displayName}</div>
                           <div className="text-[10px] text-ink font-black uppercase tracking-widest">
                             {tieneDeudaPendiente ? 'Saldo Pendiente' : (tieneDeudas ? 'Cliente al día' : 'Cliente sin deudas')}
                           </div>
                           {cedula !== 'SIN-CEDULA' && (
                             <div className="text-[9px] text-ink/40 mono">{cedula}</div>
                           )}
                        </td>
                        <td className="text-right py-4 font-black text-ink">{group.debts.length} Facturas</td>
                        <td className={`text-right py-4 font-black text-base ${tieneDeudaPendiente ? 'text-status-info' : 'text-green-600'}`}>
                          {Utils.fmtUSD(group.totalUSD)}
                        </td>
                        <td className="text-right py-4 font-black text-ink">{Utils.fmtBS(group.totalUSD * state.tasa)}</td>
                        <td className="text-center py-4">
                          {tieneDeudaPendiente ? (
                            <span className="badge badge-warn font-black text-[8px] uppercase px-3">Con Deuda</span>
                          ) : group.debts.length > 0 ? (
                            <span className="badge badge-ok font-black text-[8px] uppercase px-3">Pagado</span>
                          ) : (
                            <span className="badge badge-info font-black text-[8px] uppercase px-3">Sin Deudas</span>
                          )}
                        </td>
                        <td className="text-center py-4">
                           <div className="flex items-center justify-center gap-2">
                             {tieneDeudas ? (
                               <>
                                 <button 
                                   onClick={() => setShowClientHistory(displayName)} 
                                   className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"
                                   title="Consultar Historial Maestro"
                                 >
                                   <Eye className="w-5 h-5" />
                                 </button>
                                 {!tieneDeudaPendiente && (
                                   <button 
                                     onClick={() => eliminarCliente(displayName)} 
                                     className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-danger border-2 border-status-danger/20 hover:bg-status-danger hover:text-white transition-all shadow-md"
                                     title="Eliminar Cliente"
                                   >
                                     <Trash2 className="w-5 h-5" />
                                   </button>
                                 )}
                               </>
                             ) : (
                               <button 
                                 onClick={() => eliminarCliente(displayName)} 
                                 className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-danger border-2 border-status-danger/20 hover:bg-status-danger hover:text-white transition-all shadow-md"
                                 title="Eliminar Cliente"
                               >
                                 <Trash2 className="w-5 h-5" />
                               </button>
                             )}
                           </div>
                        </td>
                      </tr>
                      {expandedClient === key && group.debts.length > 0 && (
                        <tr className="bg-surface-soft/40 animate-in slide-in-from-top-1 duration-200">
                           <td colSpan={7} className="px-12 py-4">
                              <div className="card border-line bg-white shadow-inner rounded-xl overflow-hidden">
                                 <table className="w-full">
                                    <thead className="bg-ink/5">
                                       <tr>
                                          <th className="text-[9px] font-black uppercase p-2 text-left text-ink">Emisión</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-left text-ink">Vencimiento</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-left text-ink">ID Factura</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-right text-ink">Monto</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-right text-ink">Saldo USD</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-center text-ink">Estado</th>
                                          <th className="text-[9px] font-black uppercase p-2 text-center text-ink">Auditoría</th>
                                       </tr>
                                    </thead>
                                    <tbody>
                                       {group.debts.map((d: Debt) => (
                                          <tr key={d.id} className="border-b border-line/20 hover:bg-brand-gold-soft/10">
                                             <td className="text-[10px] font-black p-2 text-ink">{Utils.fmtFecha(d.fecha)}</td>
                                             <td className={`text-[10px] font-black p-2 ${d.fechaVencimiento < Utils.hoy() && d.estado !== 'pagada' ? 'text-status-danger' : 'text-ink'}`}>
                                                {d.fechaVencimiento === '2099-12-31' ? 'ABIERTA' : Utils.fmtFecha(d.fechaVencimiento)}
                                             </td>
                                             <td className="text-[10px] font-black p-2 mono text-ink">{d.id}</td>
                                             <td className="text-[10px] font-black p-2 text-right text-ink">{Utils.fmtUSD(d.montoUSD)}</td>
                                             <td className="text-[10px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                                             <td className="p-2 text-center">
                                               <span className={`badge ${d.estado === 'pagada' ? 'badge-ok' : (d.estado === 'parcial' ? 'badge-info' : 'badge-warn')} font-black text-[8px] uppercase px-3`}>
                                                 {d.estado}
                                               </span>
                                             </td>
                                             <td className="p-2 text-center">
                                                <div className="flex justify-center gap-1">
                                                  <button onClick={() => setShowDetails(d)} className="text-ink hover:text-brand-gold p-1 transition-colors"><Eye className="w-3.5 h-3.5"/></button>
                                                  {d.estado !== 'pagada' && (
                                                    <button onClick={() => eliminarDeuda(d)} className="text-ink hover:text-status-danger p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                                                  )}
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DETALLES AVANZADOS */}
      {showDetails && (
        <div className="modal show" style={{ zIndex: 100 }}><div className="modal-bg" onClick={() => setShowDetails(null)}></div>
          <div className="modal-box max-w-[600px] bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center text-white">
              <h3 className="font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
                <Receipt className="w-5 h-5 text-brand-gold" /> HISTORIAL DETALLADO: {showDetails.id}
              </h3>
              <button onClick={() => setShowDetails(null)} className="text-white hover:text-brand-gold"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-6 space-y-6 max-h-[75vh] overflow-y-auto bg-white">
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-3 bg-surface-soft rounded-lg border border-line">
                    <label className="text-[8px] font-black uppercase text-ink block mb-1">Monto Original</label>
                    <p className="text-lg font-black text-ink">{Utils.fmtUSD(showDetails.montoUSD)}</p>
                 </div>
                 <div className="p-3 bg-brand-gold-soft border border-brand-gold/20 rounded-lg">
                    <label className="text-[8px] font-black uppercase text-brand-gold-deep block mb-1">Saldo Actual</label>
                    <p className="text-lg font-black text-brand-gold-deep">{Utils.fmtUSD(showDetails.saldoUSD)}</p>
                 </div>
              </div>

              {(() => {
                const sale = state.ventas.find((v: any) => v.id === showDetails.ventaId || v.id === showDetails.id);
                if (!sale) return null;
                return (
                  <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex justify-between items-center border-b border-line pb-2">
                       <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em]">DETALLE DE COMPRA ORIGINAL</h4>
                       <span className="text-[9px] font-black text-ink uppercase">{Utils.fmtFecha(sale.fecha)} - {sale.fecha.split('T')[1]?.slice(0,5)}</span>
                    </div>
                    <div className="bg-surface-soft/50 rounded-lg overflow-hidden border border-line/30">
                       <table className="w-full">
                          <thead>
                            <tr className="bg-ink/5">
                               <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Cant</th>
                               <th className="text-[8px] font-black uppercase p-2 text-left text-ink">Descripción</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right text-ink">P. Unit</th>
                               <th className="text-[8px] font-black uppercase p-2 text-right text-ink">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sale.items.map((it: any, idx: number) => (
                              <tr key={idx} className="border-b border-line/20">
                                 <td className="text-[9px] font-black p-2 text-ink">{it.cantidad}</td>
                                 <td className="text-[9px] font-black uppercase p-2 text-ink truncate max-w-[180px]">{it.nombre}</td>
                                 <td className="text-[9px] font-black p-2 text-right text-ink">{Utils.fmtUSD(it.precioUnitUSD)}</td>
                                 <td className="text-[9px] font-black p-2 text-right text-brand-gold-deep">{Utils.fmtUSD(it.subtotalUSD)}</td>
                              </tr>
                            ))}
                          </tbody>
                       </table>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-3">
                 <h4 className="text-[10px] font-black uppercase text-ink tracking-[0.2em] border-b border-line pb-2">CRONOLOGÍA DE ABONOS</h4>
                 <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
                    {(!showDetails.historialPagos || showDetails.historialPagos.length === 0) ? (
                      <div className="py-10 text-center text-ink font-black uppercase italic text-[10px]">No se han registrado abonos aún</div>
                    ) : (
                      showDetails.historialPagos.map((p: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center p-3 bg-surface-soft border border-line rounded-lg">
                           <div className="space-y-0.5">
                              <p className="text-[10px] font-black text-ink uppercase">{Utils.fmtFecha(p.fecha)} - {p.fecha.split('T')[1]?.slice(0,5)}</p>
                              <p className="text-[8px] font-black text-ink mono">REF RECIBO: {p.reciboId}</p>
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
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowDetails(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL HISTORIAL COMPLETO DE CLIENTE */}
      {showClientHistory && (
        <div className="modal show"><div className="modal-bg" onClick={() => setShowClientHistory(null)}></div>
          <div className={`modal-box max-w-4xl bg-white border-2 border-line rounded-xl overflow-hidden shadow-2xl transition-all duration-500 ease-in-out ${showDetails ? 'scale-[0.85] opacity-40 -translate-y-48 blur-[1px] pointer-events-none' : ''}`}>
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
                        <th className="text-[9px] font-black uppercase p-4 text-left text-ink">Fecha</th>
                        <th className="text-[9px] font-black uppercase p-4 text-left text-ink">ID Documento</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right text-ink">Monto Total</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right text-ink">Abonado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-right text-ink">Saldo Pend.</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center text-ink">Estado</th>
                        <th className="text-[9px] font-black uppercase p-4 text-center text-ink">Auditoría</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.cxc.filter((d: Debt) => d.cliente === showClientHistory || d.cliente?.includes(showClientHistory)).sort((a: Debt, b: Debt) => b.fecha.localeCompare(a.fecha)).map((d: Debt) => (
                        <tr key={d.id} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                          <td className="p-4 text-xs font-black text-ink">{Utils.fmtFecha(d.fecha)}</td>
                          <td className="p-4 text-xs font-black mono text-ink">{d.id}</td>
                          <td className="p-4 text-right text-xs font-black text-ink">{Utils.fmtUSD(d.montoUSD)}</td>
                          <td className="p-4 text-right text-xs font-black text-status-success">{Utils.fmtUSD(d.abonadoUSD)}</td>
                          <td className="p-4 text-right text-sm font-black text-brand-gold-deep">{Utils.fmtUSD(d.saldoUSD)}</td>
                          <td className="p-4 text-center">
                            <span className={`badge ${d.estado === 'pagada' ? 'badge-ok' : (d.estado === 'parcial' ? 'badge-info' : 'badge-warn')} font-black text-[8px] uppercase px-3`}>
                              {d.estado}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                             <button onClick={() => setShowDetails(d)} className="w-10 h-10 rounded-full flex items-center justify-center bg-white text-status-success border-2 border-status-success/20 hover:bg-status-success hover:text-white transition-all shadow-md"><Eye className="w-5 h-5"/></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
               </div>
            </div>
            <div className="modal-foot p-4 bg-surface-soft border-t border-line text-right">
               <button onClick={() => setShowClientHistory(null)} className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md">Cerrar Historial</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal show">
          <div className="modal-bg" onClick={() => setShowModal(false)}></div>
          <div className="modal-box bg-white max-w-md border-2 border-line rounded-2xl overflow-hidden shadow-2xl">
            <div className="modal-head py-4 px-6 bg-surface-soft border-b border-line flex justify-between items-center">
              <h3 className="text-ink font-black uppercase text-sm flex items-center gap-2">
                <HandCoins className="w-5 h-5 text-brand-gold" /> Cargar Deuda Directa
              </h3>
              <button onClick={() => setShowModal(false)} className="text-ink hover:text-brand-gold"><X /></button>
            </div>
            <div className="modal-body p-6 space-y-5">
              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Nombre del Cliente</label>
                <input className="form-input text-ink font-black uppercase" value={nuevaDeuda.cliente} onChange={e => setNuevaDeuda({...nuevaDeuda, cliente: e.target.value})} placeholder="ESCRIBA EL NOMBRE..." />
              </div>

              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Cédula / Identificación</label>
                <div className="grid grid-cols-[100px_1fr] gap-2 items-center">
                  <select 
                    className="form-select h-11 text-xs font-black bg-surface-soft border-line w-full px-2"
                    value={nuevaDeuda.tipoDoc}
                    onChange={e => handleTipoDocChange(e.target.value)}
                  >
                    {['V', 'E', 'J', 'G', 'P'].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div className="relative">
                    <Hash className="absolute left-3 top-3 w-4 h-4 text-ink opacity-30" />
                    <input 
                      className="form-input pl-10 h-11 text-sm font-black text-ink w-full" 
                      placeholder={nuevaDeuda.tipoDoc === 'V' || nuevaDeuda.tipoDoc === 'E' ? "EJ: 13.313.521" : "EJ: 12345678"}
                      value={nuevaDeuda.cedula}
                      onChange={e => handleCedulaChange(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="text-ink text-[10px] font-black uppercase block mb-1">Monto (USD)</label>
                <input type="number" className="form-input text-xl text-brand-gold-deep font-black" value={nuevaDeuda.montoUSD} onChange={e => setNuevaDeuda({...nuevaDeuda, montoUSD: parseFloat(e.target.value) || 0})} />
              </div>
              
              <div className="flex items-center gap-2 mb-2 p-3 bg-surface-soft rounded-xl border border-line">
                <button type="button" onClick={() => setNuevaDeuda({...nuevaDeuda, sinVencimiento: !nuevaDeuda.sinVencimiento})} className="text-brand-gold">
                  {nuevaDeuda.sinVencimiento ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
                </button>
                <label className="text-ink text-[11px] font-black uppercase cursor-pointer" onClick={() => setNuevaDeuda({...nuevaDeuda, sinVencimiento: !nuevaDeuda.sinVencimiento})}>
                  Sin fecha de vencimiento (Deuda abierta)
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Origen</label>
                  <input type="date" className="form-input text-xs font-black" value={nuevaDeuda.fecha} onChange={e => setNuevaDeuda({...nuevaDeuda, fecha: e.target.value})} />
                </div>
                <div className={`form-group ${nuevaDeuda.sinVencimiento ? 'opacity-20 pointer-events-none' : ''}`}>
                  <label className="text-ink text-[10px] font-black uppercase block mb-1">Vencimiento</label>
                  <input type="date" className="form-input text-xs font-black" value={nuevaDeuda.vencimiento} onChange={e => setNuevaDeuda({...nuevaDeuda, vencimiento: e.target.value})} />
                </div>
              </div>
              <button onClick={guardarDeudaDirecta} className="btn btn-primary w-full h-14 font-black uppercase text-xs mt-4 shadow-xl tracking-widest">
                <Save className="w-4 h-4 mr-2" /> Confirmar e Ingresar a Cartera
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}