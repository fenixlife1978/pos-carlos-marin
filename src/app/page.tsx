"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  HandCoins, 
  FileText, 
  BarChart3, 
  Settings,
  Users,
  Menu,
  Wifi,
  WifiOff,
  Clock as ClockIcon,
  LogOut,
  Bell,
  ShieldCheck,
  Truck,
  BookOpen,
  ShoppingBag,
  Monitor,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  X,
  CheckCircle2,
  Calendar
} from 'lucide-react';
import { Store, initialState, Utils, Collections, PROVIDERS_COLLECTION } from '@/lib/db-store';
import { AppState, Terminal, Debt } from '@/lib/types';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot, getDoc, collection, getDocs } from 'firebase/firestore';
import DashboardModule from '@/components/modules/DashboardModule';
import { InventoryModule } from '@/components/modules/InventoryModule';
import SalesModule from '@/components/modules/SalesModule';
import PurchaseModule from '@/components/modules/PurchaseModule';
import CxCModule from '@/components/modules/CxCModule';
import CxPModule from '@/components/modules/CxPModule';
import ReportsModule from '@/components/modules/ReportsModule';
import ConfigModule from '@/components/modules/ConfigModule';
import UsersModule from '@/components/modules/UsersModule';
import GlobalControlModule from '@/components/modules/GlobalControlModule';
import SuppliersModule from '@/components/modules/SuppliersModule';
import AccountingModule from '@/components/modules/AccountingModule';

// ============================================================
// IMPORT CACHÉ DE PRODUCTOS
// ============================================================
import { cacheProductos, getProductosFromCache, clearProductosCache } from '@/lib/cache-utils';

// ============================================================
// IMPORT OFFLINE QUEUE
// ============================================================
import { getQueue, processQueue } from '@/lib/offline-queue';
import { updateStockRTDB, incrementarReciboRTDB } from '@/lib/rtdb-utils';
import { toast } from '@/hooks/use-toast';
import { asegurarStockInicial } from '@/lib/kardex-backfill';

export default function LicoreriaPOS() {
  const router = useRouter();
  const [state, setState] = useState<AppState>(initialState);
  const [activeModule, setActiveTab] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isOnline, setIsOnline] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [showApertura, setShowApertura] = useState(false);
  const [aperturaData, setAperturaData] = useState({ bs: '', usd: '' });
  
  const [dueDebts, setDueDebts] = useState<Debt[]>([]);
  const [showCxPAlert, setShowCxPAlert] = useState(false);
  
  // ============================================================
  // ALERTAS DE VENCIMIENTO (24 HORAS) - CxC + CxP
  // ============================================================
  const [dueAlerts, setDueAlerts] = useState<{
    cxp: Debt[];
    cxc: Debt[];
  }>({ cxp: [], cxc: [] });
  const [showDueAlert, setShowDueAlert] = useState(false);
  
  const moduleInitialized = useRef(false);
  const unsubscribes = useRef<(() => void)[]>([]);

  // ============================================================
  // INICIALIZACIÓN: CARGAR CONFIGURACIÓN Y SUSCRIBIRSE A COLECCIONES
  // ============================================================
  useEffect(() => {
    setMounted(true);
    const timerSafety = setTimeout(() => {
      if (loading) {
        console.warn("Safety trigger: Acceso forzado tras tiempo de espera.");
        setLoading(false);
      }
    }, 8000);

    if (!auth || !db) {
      setLoading(false);
      return;
    }

    // 1. Suscribirse a la configuración global (config/global)
    const unsubConfig = Store.subscribe((configData: Partial<AppState>) => {
      setState(prev => ({ ...prev, ...configData }) as AppState);
    });

    // 2. Suscribirse a colecciones raíz (solo si el usuario está autenticado)
    const setupSubscriptions = (terminalId?: string) => {
      // Limpiar suscripciones anteriores
      unsubscribes.current.forEach(unsub => unsub());
      unsubscribes.current = [];

      // 🔑 PRODUCTOS - CON CACHÉ
      const unsubProducts = Collections.subscribeAll('productos', (list) => {
        if (list.length > 0) {
          cacheProductos(list);
          console.log('📦 Productos guardados en caché (Firestore)');
        }
        setState(prev => ({ ...prev, productos: list }) as AppState);
      });
      unsubscribes.current.push(unsubProducts);

      const cachedProducts = getProductosFromCache();
      if (cachedProducts && cachedProducts.length > 0) {
        console.log('📦 Productos cargados desde caché local');
        setState(prev => ({ ...prev, productos: cachedProducts }) as AppState);
      }

      const unsubTerminals = Collections.subscribeAll('terminales', (list) => {
        setState(prev => ({ ...prev, terminales: list }) as AppState);
      });
      unsubscribes.current.push(unsubTerminals);

      // 🔑 VENTAS: se suscriben TODAS (sin filtrar por terminal) para que los
      // reportes X/Z, el historial de ventas y el reporte de rentabilidad nunca
      // salgan en blanco. El filtrado por terminal se hace downstream:
      // ReportsModule filtra por terminal ('all' por defecto) y SalesModule usa
      // currentTerminal.id, por lo que cada cajero solo ve lo suyo.
      const unsubSales = Collections.subscribeAll('ventas', (list) => {
        setState(prev => ({ ...prev, ventas: list }) as AppState);
      });
      unsubscribes.current.push(unsubSales);

      const unsubClients = Collections.subscribeAll('clientes', (list) => {
        setState(prev => ({ ...prev, clientes: list }) as AppState);
      });
      unsubscribes.current.push(unsubClients);

      const unsubCxc = Collections.subscribeAll('cxc', (list) => {
        setState(prev => ({ ...prev, cxc: list }) as AppState);
      });
      unsubscribes.current.push(unsubCxc);

      const unsubCxp = Collections.subscribeAll('cxp', (list) => {
        setState(prev => ({ ...prev, cxp: list }) as AppState);
      });
      unsubscribes.current.push(unsubCxp);

      // 🔑 MOVIMIENTOS: se cargan TODOS (sin filtrar por terminal) para que el
      // kardex recorra todos los movimientos desde el Stock Inicial (terminalId
      // 'SISTEMA' en los iniciales, 'ADMIN' en compras, etc.)
      const unsubMov = Collections.subscribeAll('movimientos', (list) => {
        setState(prev => ({ ...prev, movimientos: list }) as AppState);
      });
      unsubscribes.current.push(unsubMov);

      const unsubDiario = Collections.subscribeAll('libroDiario', (list) => {
        setState(prev => ({ ...prev, libroDiario: list }) as AppState);
      });
      unsubscribes.current.push(unsubDiario);

      const unsubDev = Collections.subscribeAll('devoluciones', (list) => {
        setState(prev => ({ ...prev, devoluciones: list }) as AppState);
      });
      unsubscribes.current.push(unsubDev);

      const unsubAnu = Collections.subscribeAll('anulaciones', (list) => {
        setState(prev => ({ ...prev, anulaciones: list }) as AppState);
      });
      unsubscribes.current.push(unsubAnu);

      const unsubZ = Collections.subscribeAll('reportesZ', (list) => {
        setState(prev => ({ ...prev, reportesZ: list }) as AppState);
      });
      unsubscribes.current.push(unsubZ);

      // 🔑 PROVEEDORES - Desde su propia colección raíz
      const unsubProveedores = Collections.subscribeAll(PROVIDERS_COLLECTION, (list) => {
        setState(prev => ({ ...prev, proveedores: list }) as AppState);
      });
      unsubscribes.current.push(unsubProveedores);
    };

    // 3. Autenticación
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push('/login');
        return;
      }

      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        
        if (!userDocSnap.exists()) {
          await signOut(auth);
          router.push('/login');
          return;
        }

        const data = userDocSnap.data();
        
        if (data.accesoBloqueado) {
          await signOut(auth);
          if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
          router.push('/login');
          return;
        }

        let terminal = null;
        if (data.rol === 'cajero') {
          const terminalsSnapshot = await getDocs(collection(db, 'terminales'));
          const terminales = terminalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Terminal));
          terminal = terminales.find(t => t.usuarioId === currentUser.uid);
          
          if (!terminal) {
            await signOut(auth);
            alert("ACCESO RESTRINGIDO: Su usuario no tiene un terminal asignado.");
            router.push('/login');
            return;
          }
        }

        const terminalId = terminal?.id || 'GLOBAL';

        setupSubscriptions(terminalId);

        // 🔑 KARDEX: asegurar el movimiento de Stock Inicial de todos los productos.
        // Backfill idempotente. Se re-ejecuta cada 24h para cubrir productos nuevos.
        if (typeof localStorage !== 'undefined') {
          const lastBackfill = Number(localStorage.getItem('posven_stock_inicial_done') || 0);
          if (Date.now() - lastBackfill > 24 * 60 * 60 * 1000) {
            asegurarStockInicial()
              .then(n => {
                if (n > 0) console.log(`📦 Kardex: ${n} movimientos de Stock Inicial reconstruidos`);
                localStorage.setItem('posven_stock_inicial_done', String(Date.now()));
              })
              .catch(e => console.error('Backfill Stock Inicial:', e));
          }
        }

        setUser(currentUser);
        setUserRole(data.rol);
        setUserProfile(data);

        if (data.rol === 'cajero' && terminal) {
          setState(prev => ({ ...prev, terminales: [terminal] }) as AppState);
        }

        if (data.rol === 'cajero') {
          const aperturaConfirmada = localStorage.getItem('posven_apertura_done') === 'true';
          setShowApertura(!aperturaConfirmada);
        } else {
          setShowApertura(false);
        }

        if (!moduleInitialized.current) {
          const savedModule = sessionStorage.getItem('posven_active_module');
          const target = data.rol === 'cajero' 
            ? (savedModule || 'ventas') 
            : (savedModule || 'dashboard');
          setActiveTab(target);
          moduleInitialized.current = true;
        }

        setLoading(false);

      } catch (error) {
        console.error("Auth process error:", error);
        setLoading(false);
      }
    });

    const timerClock = setInterval(() => setCurrentTime(new Date()), 1000);

    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      const hOnline = () => setIsOnline(true);
      const hOffline = () => setIsOnline(false);
      window.addEventListener('online', hOnline);
      window.addEventListener('offline', hOffline);
      return () => {
        unsubscribeAuth();
        unsubConfig();
        unsubscribes.current.forEach(unsub => unsub());
        clearInterval(timerClock);
        clearTimeout(timerSafety);
        window.removeEventListener('online', hOnline);
        window.removeEventListener('offline', hOffline);
      };
    }
    
    return () => {
      unsubscribeAuth();
      unsubConfig();
      unsubscribes.current.forEach(unsub => unsub());
      clearInterval(timerClock);
      clearTimeout(timerSafety);
    };
  }, [router, loading]);

  // ============================================================
  // SINCRONIZACIÓN DE COLA OFFLINE
  // ============================================================
  useEffect(() => {
    const syncOfflineSales = async () => {
      const queue = getQueue();
      if (queue.length === 0) return;
      
      console.log(`🔄 Sincronizando ${queue.length} ventas offline...`);
      
      toast({
        title: "🔄 Sincronizando ventas offline",
        description: `${queue.length} ventas pendientes...`,
        duration: 3000
      });
      
      const processed = await processQueue(async (data) => {
        await Collections.set('ventas', data.venta.id, data.venta);
        await Collections.set('libroDiario', data.asiento.id, data.asiento);
        await updateStockRTDB(data.itemsParaStock);
        await incrementarReciboRTDB(data.terminalId);
      });
      
      if (processed > 0) {
        toast({
          title: "✅ Ventas sincronizadas",
          description: `${processed} ventas offline procesadas correctamente.`,
          duration: 5000
        });
      }
    };
    
    const handleOnline = () => {
      syncOfflineSales();
    };
    
    window.addEventListener('online', handleOnline);
    
    if (typeof window !== 'undefined' && navigator.onLine) {
      setTimeout(syncOfflineSales, 3000);
    }
    
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // ============================================================
  // ALERTAS DE VENCIMIENTO (24 HORAS) - CxC + CxP
  // ============================================================
  useEffect(() => {
    const checkDueDocuments = () => {
      const now = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);

      // CxP (Proveedores)
      const cxpVencidas = (state.cxp || []).filter(d => {
        if (d.estado === 'pagada') return false;
        const dueDate = new Date(d.fechaVencimiento + 'T23:59:59');
        return dueDate <= tomorrow && dueDate >= now;
      });

      // CxC (Clientes) - Excluir deudas abiertas (2099-12-31)
      const cxcVencidas = (state.cxc || []).filter(d => {
        if (d.estado === 'pagada') return false;
        if (d.fechaVencimiento === '2099-12-31') return false;
        const dueDate = new Date(d.fechaVencimiento + 'T23:59:59');
        return dueDate <= tomorrow && dueDate >= now;
      });

      const hasAlerts = cxpVencidas.length > 0 || cxcVencidas.length > 0;

      if (hasAlerts && userRole === 'administrador') {
        setDueAlerts({ cxp: cxpVencidas, cxc: cxcVencidas });
        
        const lastAlert = localStorage.getItem('posven_due_alert');
        const fiveMinutes = 5 * 60 * 1000;
        
        if (!lastAlert || (Date.now() - parseInt(lastAlert)) > fiveMinutes) {
          setShowDueAlert(true);
          localStorage.setItem('posven_due_alert', Date.now().toString());
        }
      }
    };

    checkDueDocuments();
    const interval = setInterval(checkDueDocuments, 60000);
    
    return () => clearInterval(interval);
  }, [state.cxp, state.cxc, userRole]);

  // LÓGICA DE NOTIFICACIONES CXP (CADA 6 HORAS / 72H VENCIMIENTO) - PARA COMPATIBILIDAD
  useEffect(() => {
    if (!state.cxp || state.cxp.length === 0 || userRole !== 'administrador') return;

    const checkDueDebts = () => {
      const now = new Date();
      const limitDate = new Date();
      limitDate.setHours(limitDate.getHours() + 72);

      const pending = state.cxp.filter(d => {
        if (d.estado === 'pagada') return false;
        const dueDate = new Date(d.fechaVencimiento + 'T23:59:59');
        return dueDate <= limitDate;
      });

      setDueDebts(pending);

      if (pending.length > 0) {
        const lastAlert = localStorage.getItem('posven_last_cxp_alert');
        const sixHours = 6 * 60 * 60 * 1000;
        
        if (!lastAlert || (Date.now() - parseInt(lastAlert)) > sixHours) {
          setShowCxPAlert(true);
        }
      }
    };

    checkDueDebts();
    const interval = setInterval(checkDueDebts, 60000);
    return () => clearInterval(interval);
  }, [state.cxp, userRole]);

  useEffect(() => {
    if (mounted) {
      // 🔑 CARRI TO EN localStorage: sobrevive a cortes de luz y cierres
      // bruscos del navegador (sessionStorage se pierde al apagarse el equipo).
      const savedCart = localStorage.getItem('posven_current_cart');
      if (savedCart) {
        try {
          const items = JSON.parse(savedCart);
          if (items.length > 0) {
            setState(prev => ({ ...prev, carrito: items }) as AppState);
          }
        } catch (e) {}
      }
    }
  }, [mounted]);

  useEffect(() => {
    if (mounted && state.carrito) {
      localStorage.setItem('posven_current_cart', JSON.stringify(state.carrito));
    }
  }, [state.carrito, mounted]);

  useEffect(() => {
    if (mounted && activeModule) {
      sessionStorage.setItem('posven_active_module', activeModule);
    }
  }, [activeModule, mounted]);

  const handleLogout = async () => {
    if (confirm('¿Cerrar sesión del sistema?')) {
      setLoading(true);
      try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
        if (auth) await signOut(auth);
        router.push('/login');
      } catch (e) {
        if (auth) await signOut(auth);
        router.push('/login');
      }
    }
  };

  const updateState = (newState: Partial<AppState>) => {
    setState(prev => {
      const updated = { ...prev, ...newState } as AppState;
      Store.set(updated);
      return updated;
    });
  };

  const handleModuleChange = (moduleId: string) => {
    if (userRole === 'cajero' && moduleId !== 'ventas') return;
    setActiveTab(moduleId);
    setIsSidebarOpen(false);
  };

  const markAlertAsRead = () => {
    localStorage.setItem('posven_last_cxp_alert', Date.now().toString());
    setShowCxPAlert(false);
  };

  const totalAlerts = dueAlerts.cxp.length + dueAlerts.cxc.length;

  const menuGroups = [
    {
      id: 'operaciones',
      label: 'Operaciones',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'inventario', label: 'Inventario', icon: Package, count: (state.productos || []).filter((p: any) => p.activo).length },
        { id: 'compras', label: 'Entradas (Compras)', icon: ShoppingBag },
      ]
    },
    {
      id: 'finanzas',
      label: 'Finanzas',
      items: [
        { id: 'contabilidad', label: 'Contabilidad', icon: BookOpen },
        { id: 'cxc', label: 'Cuentas por Cobrar', icon: HandCoins, count: (state.cxc || []).filter((x: any) => x.estado !== 'pagada').length },
        { id: 'cxp', label: 'Cuentas por Pagar', icon: FileText, count: (state.cxp || []).filter((x: any) => x.estado !== 'pagada').length },
      ]
    },
    {
      id: 'sistema',
      label: 'Sistema',
      items: [
        { id: 'reportes', label: 'Reportes', icon: BarChart3 },
        { id: 'config', label: 'Configuración', icon: Settings },
        { id: 'usuarios', label: 'Usuarios', icon: Users },
        { id: 'global_control', label: 'Global Control', icon: ShieldCheck },
      ]
    }
  ];

  const renderModule = () => {
    if (!mounted || loading || !activeModule) return null;
    switch (activeModule) {
      case 'dashboard': return <DashboardModule state={state} />;
      case 'inventario': return <InventoryModule state={state} updateState={updateState} />;
      case 'ventas': return <SalesModule state={state} updateState={updateState} />;
      case 'compras': return <PurchaseModule state={state} updateState={updateState} />;
      case 'proveedores': return <SuppliersModule state={state} updateState={updateState} />;
      case 'contabilidad': return <AccountingModule state={state} updateState={updateState} />;
      case 'cxc': return <CxCModule state={state} updateState={updateState} />;
      case 'cxp': return <CxPModule state={state} updateState={updateState} />;
      case 'reportes': return <ReportsModule state={state} />;
      case 'config': return <ConfigModule state={state} updateState={updateState} />;
      case 'usuarios': return <UsersModule />;
      case 'global_control': return <GlobalControlModule state={state} updateState={updateState} />;
      default: return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-brand-gold/20 border-t-brand-gold rounded-full animate-spin" />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">Iniciando PosVEN Pro...</p>
        </div>
      </div>
    );
  }

  const isCajero = userRole === 'cajero';

  if (showApertura && isCajero) {
    const timeStr = mounted ? currentTime.toLocaleTimeString('es-VE', { 
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'America/Caracas' 
    }) : '--:--:--';
    const dateStr = mounted ? currentTime.toLocaleDateString('es-VE', { 
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Caracas'
    }) : '...';

    const terminalActual = state.terminales.find(t => t.usuarioId === user?.uid);
    const nextRecibo = terminalActual?.proximoRecibo || state.proximoRecibo;

    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center p-6 font-sans no-print">
         <div className="w-full max-w-[480px] bg-white rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.1)] p-10 space-y-6 animate-in fade-in zoom-in duration-500 border border-line">
            <div className="text-center">
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="w-10 h-10 bg-brand-gold rounded-xl flex items-center justify-center text-black font-black text-xl shadow-lg">P</div>
                <div className="font-display font-black text-xl text-ink tracking-tighter uppercase">Pos<span className="text-brand-gold">VEN</span> Pro</div>
              </div>
              <div className="h-0.5 w-10 bg-brand-gold rounded-full mx-auto mb-2"></div>
              <h1 className="text-base font-extrabold text-ink tracking-tight uppercase italic">Apertura de Jornada</h1>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-surface-soft rounded-xl border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Terminal</label>
                  <p className="text-[10px] font-black text-brand-gold-deep uppercase truncate">{terminalActual?.nombre || 'S/T'}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-xl border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Responsable</label>
                  <p className="text-[10px] font-black text-ink uppercase truncate">{userProfile?.nombre || 'Operador'}</p>
                </div>
                <div className="p-3 bg-surface-soft rounded-xl border border-line">
                  <label className="text-[8px] font-black uppercase text-ink/50 block mb-1">Recibo Inicio</label>
                  <p className="text-[10px] font-black text-ink"># {String(nextRecibo).padStart(9, '0')}</p>
                </div>
              </div>

              <div className="p-3 bg-ink text-white rounded-xl flex justify-between items-center">
                <div className="space-y-0.5">
                  <label className="text-[8px] font-bold uppercase opacity-50 block tracking-widest">Fecha</label>
                  <p className="text-[9px] font-black uppercase">{dateStr}</p>
                </div>
                <div className="text-right space-y-0.5">
                  <label className="text-[8px] font-bold uppercase opacity-50 block tracking-widest">Hora</label>
                  <p className="text-[9px] font-black uppercase">{timeStr}</p>
                </div>
              </div>

              <div className="space-y-4">
                 <div className="form-group">
                    <label className="text-ink text-[9px] font-black uppercase block mb-1.5 opacity-70">Fondo Efectivo Bs.</label>
                    <input type="text" className="form-input h-11 text-lg font-black text-center text-ink bg-surface-soft/40 border-line" value={aperturaData.bs} onChange={e => setAperturaData({...aperturaData, bs: e.target.value.replace(/[^0-9.]/g, '')})} />
                 </div>
                 <div className="form-group">
                    <label className="text-ink text-[9px] font-black uppercase block mb-1.5 opacity-70">Fondo Efectivo USD</label>
                    <input type="text" className="form-input h-11 text-lg font-black text-center text-brand-gold-deep bg-surface-soft/40 border-line" value={aperturaData.usd} onChange={e => setAperturaData({...aperturaData, usd: e.target.value.replace(/[^0-9.]/g, '')})} />
                 </div>
              </div>

              <button 
                disabled={aperturaData.bs === '' || aperturaData.usd === ''} 
                onClick={() => { 
                  const bsValue = parseFloat(aperturaData.bs) || 0;
                  const usdValue = parseFloat(aperturaData.usd) || 0;
                  
                  const currentState = Store.get();
                  const newState: AppState = {
                    ...initialState,
                    ...currentState,
                    user: currentState.user || null,
                    fondoCajaHoyBS: bsValue,
                    fondoCajaHoyUSD: usdValue,
                    isCashOpen: true,
                    tasa: currentState.tasa || state.tasa || 36.50,
                    empresa: currentState.empresa || state.empresa || initialState.empresa
                  };
                  Store.set(newState);
                  setState(newState);
                  
                  localStorage.setItem('posven_apertura_done', 'true'); 
                  setShowApertura(false); 
                }} 
                className="w-full h-14 bg-brand-gold text-ink font-black text-sm rounded-xl shadow-xl shadow-brand-gold/10 hover:bg-brand-gold-deep hover:text-white transition-all uppercase tracking-widest"
              >
                Confirmar Apertura
              </button>
            </div>
         </div>
      </div>
    );
  }

  const timeStr = mounted ? currentTime.toLocaleTimeString('es-VE', { 
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'America/Caracas' 
  }) : '--:--:--';

  const dateStr = mounted ? currentTime.toLocaleDateString('es-VE', { 
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Caracas'
  }) : '...';

  return (
    <div className="flex min-h-screen bg-surface-warm text-ink overflow-hidden">
      <aside 
        onMouseLeave={() => setIsSidebarOpen(false)}
        className={`fixed top-0 left-0 w-[260px] h-screen bg-white border-line flex flex-col z-50 transition-all duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} border-r shadow-2xl`}
      >
        <div className="p-6 border-b border-line flex flex-col gap-1 relative">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-ink border border-brand-gold rounded-[10px] flex items-center justify-center font-black text-brand-gold text-lg shadow-sm">P</div>
            <div>
              <div className="font-display font-[800] text-lg leading-none text-ink">Pos<span className="text-brand-gold">VEN</span> Pro</div>
              <div className="text-[0.68rem] font-bold text-ink uppercase tracking-widest mt-1">Soluciones Venezuela</div>
            </div>
          </div>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border border-line rounded-full flex items-center justify-center text-ink hover:text-brand-gold shadow-sm"
          >
            <ChevronLeft size={14} />
          </button>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-6">
          {menuGroups.map((group) => (
            <div key={group.id} className="space-y-1">
              <div className="px-2.5 mb-2 text-[0.66rem] font-bold text-ink uppercase tracking-[0.18em]">{group.label}</div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = activeModule === item.id;
                  return (
                    <button key={item.id} onClick={() => handleModuleChange(item.id)} className={`w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-[10px] text-[0.9rem] font-bold transition-all group relative ${active ? 'bg-brand-gold-soft text-brand-gold-deep' : 'text-ink hover:bg-surface-soft hover:text-ink'}`}>
                      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-brand-gold rounded-r-full" />}
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${active ? 'text-brand-gold-deep' : 'text-ink group-hover:text-ink'}`} />
                        {item.label}
                      </div>
                      {item.count !== undefined && (
                        <span className={`px-2 py-0.5 rounded-full text-[0.7rem] font-black ${active ? 'bg-brand-gold text-white' : 'bg-surface-soft text-ink'}`}>{item.count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        
        <div className="p-4 border-t border-line bg-surface-warm/50 flex flex-col gap-2">
          <div className="bg-brand-gold-soft border border-[#EFD9A4] rounded-lg p-3 flex items-center gap-3 shadow-sm">
            <div className="flex-1">
              <div className="text-[0.62rem] font-bold text-brand-gold-deep uppercase tracking-widest mb-1 leading-none">Tasa BCV</div>
              <div className="font-display font-[800] text-sm text-ink">{state.tasa.toFixed(2)} <span className="text-[0.7rem] font-black opacity-60">Bs/USD</span></div>
            </div>
          </div>
          
          <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[10px] text-[0.8rem] font-black text-status-danger hover:bg-status-danger-soft transition-all uppercase tracking-widest">
            <LogOut className="w-4 h-4" /> Cerrar Sistema
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-screen max-w-full overflow-hidden">
        <header className="sticky top-0 z-30 bg-surface-warm/85 backdrop-blur-md border-b border-line px-7 py-3.5 flex items-center gap-6 no-print">
          {!isCajero && (
            <button className="p-2 -ml-2 text-ink hover:text-brand-gold" onClick={() => setIsSidebarOpen(true)}>
              <Menu className="w-[20px] h-[20px]" />
            </button>
          )}
          
          <div className="shrink-0">
            <h2 className="font-display text-lg font-[800] text-ink leading-tight">Pos<span className="text-brand-gold">VEN</span> pro</h2>
            <p className="text-[0.7rem] text-ink uppercase font-bold tracking-widest">{isCajero ? 'Terminal de Punto de Venta' : 'Soluciones Venezuela'}</p>
          </div>

          <div className="hidden md:flex items-center gap-4 mx-auto">
            <div className="flex items-center gap-2.5 px-4 py-2 bg-white/70 rounded-xl border border-line shadow-sm min-w-[160px]">
              <div className="w-8 h-8 bg-brand-gold-soft rounded-lg flex items-center justify-center"><ClockIcon className="w-4 h-4 text-brand-gold-deep" /></div>
              <div className="flex flex-col">
                <span className="text-[0.65rem] font-black uppercase text-ink opacity-50 leading-none mb-0.5">{dateStr}</span>
                <span className="text-[0.88rem] font-black text-ink leading-none tabular-nums">{timeStr}</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 px-4 py-2 bg-white/70 rounded-xl border border-line shadow-sm">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${mounted && isOnline ? 'bg-status-success-soft' : 'bg-status-danger-soft'}`}>
                {mounted && isOnline ? <Wifi className="w-4 h-4 text-status-success" /> : <WifiOff className="w-4 h-4 text-status-danger" />}
              </div>
              <div className="flex flex-col">
                <span className="text-[0.65rem] font-black uppercase text-ink opacity-50 leading-none mb-0.5">Cloud Sync</span>
                <div className="flex items-center gap-1.5 leading-none">
                  <div className={`w-1.5 h-1.5 rounded-full ${mounted ? (isOnline ? 'bg-status-success animate-pulse' : 'bg-status-danger') : 'bg-ink/20'}`} />
                  <span className={`text-[0.74rem] font-black uppercase ${mounted ? (isOnline ? 'text-status-success' : 'text-status-danger') : 'text-ink/20'}`}>{mounted ? (isOnline ? 'En Línea' : 'Modo Offline') : 'Iniciando...'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            {!isCajero && (
              <button 
                onClick={() => totalAlerts > 0 && setShowDueAlert(true)}
                className="relative w-[38px] h-[38px] rounded-[10px] bg-white border border-line flex items-center justify-center text-ink hover:text-brand-gold transition-colors shadow-sm-card"
              >
                <Bell className={`w-4 h-4 ${totalAlerts > 0 ? 'text-brand-gold animate-bounce' : ''}`} />
                {totalAlerts > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-status-danger text-white rounded-full flex items-center justify-center text-[9px] font-black border-2 border-white">
                    {totalAlerts}
                  </span>
                )}
              </button>
            )}
            
            <div className="flex items-center gap-2.5 pl-3 border-l border-line ml-1">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-bold text-ink leading-none">{userProfile?.nombre || 'Usuario'}</div>
                <div className="text-[0.66rem] font-bold text-ink opacity-60 uppercase mt-1 tracking-wider">{userRole === 'administrador' ? 'Panel Control' : 'Modo Operativo'}</div>
              </div>
              <div className="w-[34px] h-[34px] rounded-full bg-gradient-to-br from-brand-gold to-[#E7B857] flex items-center justify-center text-white font-black text-xs border border-white/20 shadow-sm uppercase">{userProfile?.nombre?.charAt(0) || 'U'}</div>
            </div>
            
            <button onClick={handleLogout} className="w-10 h-10 bg-status-danger-soft text-status-danger rounded-xl flex items-center justify-center hover:bg-status-danger hover:text-white transition-all shadow-sm" title="Cerrar Sistema"><LogOut className="w-5 h-5" /></button>
          </div>
        </header>
        
        <div className="p-7 flex-1 overflow-y-auto">{renderModule()}</div>

        <footer className="px-8 py-6 border-t border-line text-[0.76rem] font-black text-ink flex flex-col sm:flex-row justify-between gap-4 no-print bg-surface-warm/30">
          <div>© 2026 PosVEN Pro · Persistencia Offline Activa</div>
          <div className="flex gap-4 items-center">
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-status-success animate-pulse' : 'bg-status-warn'}`} /> {isOnline ? 'Nube Sincronizada' : 'Sincronización Pendiente'}
            </span>
            <span className="px-2 py-0.5 bg-white border border-line rounded text-[0.65rem] font-black">v2.5.6-resilient</span>
          </div>
        </footer>
      </main>

      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-[45] backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* ============================================================
        MODAL DE ALERTA DE VENCIMIENTO (CxC + CxP)
      ============================================================ */}
      {showDueAlert && (
        <div className="modal show" style={{ zIndex: 9999 }}>
          <div className="modal-bg" onClick={() => setShowDueAlert(false)} />
          <div className="modal-box max-w-2xl bg-white border-2 border-line rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in duration-300">
            <div className="modal-head py-5 px-8 bg-ink border-b border-white/10 flex justify-between items-center text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-gold rounded-xl flex items-center justify-center text-black shadow-lg">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-black text-sm uppercase italic tracking-widest">⚠️ Documentos por Vencer</h3>
                  <p className="text-[9px] font-bold text-white/40 uppercase tracking-tighter">
                    {totalAlerts} documento(s) vencen en las próximas 24 horas
                  </p>
                </div>
              </div>
              <button onClick={() => setShowDueAlert(false)} className="text-white/20 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="modal-body p-6 space-y-6 bg-white max-h-[60vh] overflow-y-auto">
              
              {/* Cuentas por Pagar (Proveedores) */}
              {dueAlerts.cxp.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase text-ink/60 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-status-danger" />
                    Cuentas por Pagar ({dueAlerts.cxp.length})
                  </h4>
                  <div className="space-y-2">
                    {dueAlerts.cxp.map(d => {
                      const diff = new Date(d.fechaVencimiento + 'T23:59:59').getTime() - Date.now();
                      const horas = Math.ceil(diff / (1000 * 60 * 60));
                      return (
                        <div key={d.id} className="p-3 bg-status-danger-soft border border-status-danger/20 rounded-xl flex justify-between items-center">
                          <div>
                            <p className="text-[10px] font-black text-ink uppercase">{d.proveedor}</p>
                            <p className="text-[9px] font-bold text-ink/60">Ref: {d.numeroFactura || d.id}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-status-danger">{Utils.fmtUSD(d.saldoUSD)}</p>
                            <p className="text-[8px] font-black text-ink/40 uppercase">
                              {horas <= 0 ? 'VENCE HOY' : `Vence en ${horas}h`}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Cuentas por Cobrar (Clientes) */}
              {dueAlerts.cxc.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black uppercase text-ink/60 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-status-warn" />
                    Cuentas por Cobrar ({dueAlerts.cxc.length})
                  </h4>
                  <div className="space-y-2">
                    {dueAlerts.cxc.map(d => {
                      const diff = new Date(d.fechaVencimiento + 'T23:59:59').getTime() - Date.now();
                      const horas = Math.ceil(diff / (1000 * 60 * 60));
                      return (
                        <div key={d.id} className="p-3 bg-status-warn-soft border border-status-warn/20 rounded-xl flex justify-between items-center">
                          <div>
                            <p className="text-[10px] font-black text-ink uppercase">{d.cliente}</p>
                            <p className="text-[9px] font-bold text-ink/60">Ref: {d.id}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-status-warn">{Utils.fmtUSD(d.saldoUSD)}</p>
                            <p className="text-[8px] font-black text-ink/40 uppercase">
                              {horas <= 0 ? 'VENCE HOY' : `Vence en ${horas}h`}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {totalAlerts === 0 && (
                <div className="py-10 text-center text-ink/40 font-black uppercase italic text-[10px]">
                  No hay documentos por vencer. ¡Todo en orden! ✅
                </div>
              )}

              <div className="bg-ink/5 p-3 rounded-xl border border-line text-center">
                <p className="text-[8px] font-black text-ink/40 uppercase tracking-widest">
                  Este recordatorio se muestra cada 5 minutos hasta que se liquiden las deudas.
                </p>
              </div>
            </div>

            <div className="modal-foot p-4 bg-surface-soft border-t border-line flex justify-end">
              <button 
                onClick={() => setShowDueAlert(false)}
                className="btn btn-primary px-8 font-black uppercase text-[10px] rounded-lg shadow-md"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}

      {showCxPAlert && (
        <div className="modal show" style={{ zIndex: 9999 }}>
          <div className="modal-bg" />
          <div className="modal-box max-w-lg bg-white border-2 border-line rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in duration-300">
            <div className="modal-head py-5 px-8 bg-ink border-b border-white/10 flex justify-between items-center text-white">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-brand-gold rounded-xl flex items-center justify-center text-black shadow-lg">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-black text-sm uppercase italic tracking-widest">Alerta de Vencimiento</h3>
                    <p className="text-[9px] font-bold text-white/40 uppercase tracking-tighter">Compromisos con Proveedores</p>
                  </div>
               </div>
               <button onClick={markAlertAsRead} className="text-white/20 hover:text-white transition-colors"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-8 space-y-6 bg-white max-h-[60vh] overflow-y-auto">
               <div className="p-4 bg-status-danger-soft border border-status-danger/20 rounded-2xl">
                 <p className="text-[11px] font-bold text-status-danger uppercase leading-tight text-center">
                   Usted tiene {dueDebts.length} facturas por pagar que vencen en menos de 72 horas.
                 </p>
               </div>

               <div className="space-y-3">
                 {dueDebts.map(d => {
                   const diff = new Date(d.fechaVencimiento + 'T23:59:59').getTime() - Date.now();
                   const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
                   return (
                     <div key={d.id} className="p-4 bg-surface-soft border border-line rounded-2xl flex items-center justify-between group hover:border-brand-gold transition-all">
                        <div className="space-y-1">
                          <p className="text-[10px] font-black text-ink uppercase">{d.proveedor}</p>
                          <div className="flex items-center gap-2">
                             <span className="badge badge-neutral text-[8px] font-black uppercase">Ref: {d.numeroFactura || d.id.slice(-6)}</span>
                             <span className="flex items-center gap-1 text-[9px] font-bold text-status-danger uppercase">
                               <Calendar className="w-3 h-3" /> Vence en {days} {days === 1 ? 'día' : 'días'}
                             </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-ink">{Utils.fmtUSD(d.saldoUSD)}</p>
                          <p className="text-[9px] font-bold text-ink/40 uppercase italic">Saldo Pendiente</p>
                        </div>
                     </div>
                   );
                 })}
               </div>

               <div className="bg-brand-gold-soft/30 p-4 rounded-2xl border border-brand-gold/10">
                 <p className="text-[9px] font-bold text-brand-gold-deep uppercase leading-relaxed text-center italic">
                   Este recordatorio volverá a aparecer en 6 horas para asegurar la liquidez de sus compromisos.
                 </p>
               </div>
            </div>
            <div className="modal-foot p-6 bg-surface-soft border-t border-line">
               <button 
                onClick={markAlertAsRead}
                className="w-full h-14 bg-brand-gold text-black font-black text-sm rounded-2xl shadow-xl shadow-brand-gold/10 hover:bg-brand-gold-deep hover:text-white transition-all uppercase tracking-widest flex items-center justify-center gap-3"
               >
                 <CheckCircle2 className="w-5 h-5" /> Entendido, Revisaré los pagos
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}