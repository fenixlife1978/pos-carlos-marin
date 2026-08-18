'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AppState } from '@/lib/types';
import { Save, AlertTriangle, RefreshCw, Database } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { initialState, Store, limpiarConfigGlobal } from '@/lib/db-store';
import { db, auth, rtdb } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc, setDoc, writeBatch, query, limit } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { ref, remove } from 'firebase/database';
import { crearRespaldo, descargarRespaldo, cargarRespaldoDesdeArchivo } from '@/lib/backup';

export default function ConfigModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [tasa, setTasa] = useState<string | number>(state.tasa || 36.50);
  const [comision, setComision] = useState<string | number>(state.comisionEfectivo || 5);
  const [empresa, setEmpresa] = useState(state.empresa || { nombre: '', rif: '', direccion: '', telefono: '' });
  const [pinDevolucion, setPinDevolucion] = useState(state.pinDevolucion || '');
  const [isFormatting, setIsFormatting] = useState(false);

  useEffect(() => {
    if (state.tasa !== undefined && state.tasa !== null) {
      setTasa(state.tasa);
    }
    if (state.comisionEfectivo !== undefined && state.comisionEfectivo !== null) {
      setComision(state.comisionEfectivo);
    }
    if (state.empresa) {
      setEmpresa(state.empresa);
    }
    if (state.pinDevolucion !== undefined) {
      setPinDevolucion(state.pinDevolucion || '');
    }
  }, [state.tasa, state.empresa, state.pinDevolucion, state.comisionEfectivo]);

  const guardarTasa = () => {
    const n = parseFloat(tasa.toString());
    if (isNaN(n) || n <= 0) return alert('Tasa inválida (debe ser mayor a 0)');
    updateState({ tasa: n });
    Store.set({ tasa: n });
    toast({ title: "Sincronizado", description: "Tasa de cambio actualizada en todos los terminales." });
  };

  const guardarComision = () => {
    const n = parseFloat(comision.toString());
    if (isNaN(n) || n < 0) return alert('Comisión inválida (debe ser mayor o igual a 0)');
    updateState({ comisionEfectivo: n });
    Store.set({ comisionEfectivo: n });
    toast({ title: "Sincronizado", description: "Comisión de efectivo actualizada correctamente." });
  };

  const guardarEmpresa = () => {
    if (!empresa.nombre.trim()) return alert('El nombre del negocio es requerido');
    updateState({ empresa });
    Store.set({ empresa });
    toast({ title: "Perfil Actualizado", description: "Los datos fiscales han sido guardados." });
  };

  const guardarPin = () => {
    const cleanPin = pinDevolucion.replace(/\D/g, '');
    if (cleanPin.length !== 6) return alert('El PIN debe ser de 6 dígitos exactos');
    updateState({ pinDevolucion: cleanPin });
    Store.set({ pinDevolucion: cleanPin });
    toast({ title: "Seguridad Actualizada", description: "PIN de autorización establecido correctamente." });
  };

  // ============================================================
  // FUNCIÓN RÁPIDA PARA ELIMINAR UNA COLECCIÓN COMPLETA
  // ============================================================
  const deleteCollection = async (collectionPath: string) => {
    try {
      const colRef = collection(db, collectionPath);
      const snapshot = await getDocs(colRef);
      
      if (snapshot.empty) {
        console.log(`✅ Colección "${collectionPath}" vacía o no existe.`);
        return 0;
      }

      let totalDeleted = 0;
      
      // Eliminar documentos uno por uno (más rápido que batch para este caso)
      for (const docSnap of snapshot.docs) {
        await deleteDoc(docSnap.ref);
        totalDeleted++;
      }
      
      console.log(`✅ Colección "${collectionPath}" eliminada (${totalDeleted} docs).`);
      return totalDeleted;
    } catch (error) {
      console.warn(`⚠️ Error al eliminar colección "${collectionPath}":`, error);
      return 0;
    }
  };

  // ============================================================
  // FUNCIÓN PARA LIMPIAR RTDB
  // ============================================================
  const limpiarRTDB = async () => {
    try {
      console.log('🗑️ Limpiando Realtime Database...');
      await remove(ref(rtdb));
      console.log('✅ Realtime Database limpiada completamente.');
      return true;
    } catch (error) {
      console.warn('⚠️ Error al limpiar RTDB:', error);
      return false;
    }
  };

  const formatearSistema = async () => {
    const confirmMsg = 
      '⚠️ ¿ESTÁ ABSOLUTAMENTE SEGURO?\n\n' +
      'ESTA ACCIÓN ELIMINARÁ PERMANENTEMENTE:\n' +
      '✅ TODOS los productos e inventario.\n' +
      '✅ TODAS las ventas y créditos.\n' +
      '✅ TODOS los clientes y proveedores.\n' +
      '✅ TODOS los movimientos y asientos contables.\n' +
      '✅ TODOS los usuarios y sus credenciales.\n' +
      '✅ TODOS los reportes y configuraciones.\n' +
      '✅ TODOS los datos de la Realtime Database.\n\n' +
      '⚠️ ESTA ACCIÓN NO SE PUEDE DESHACER.';

    if (!confirm(confirmMsg)) return;

    setIsFormatting(true);
    
    // Mostrar toast de inicio
    toast({ 
      title: "⏳ Formateando sistema...", 
      description: "Eliminando todos los datos (Firestore + RTDB). Esto puede tomar unos segundos.",
      duration: 3000
    });

    try {
      // Lista de colecciones a eliminar (en orden de prioridad)
      const colecciones = [
        'ventas',
        'productos',
        'clientes',
        'cxc',
        'cxp',
        'movimientos',
        'terminales',
        'proveedores',
        'devoluciones',
        'anulaciones',
        'libroDiario',
        'reportesZ',
        'catalogos',
        'inventario',
        'config',
        'users',
        'pos_system_data'
      ];

      console.log('🗑️ Iniciando eliminación rápida de colecciones...');
      
      // Eliminar colecciones en paralelo (más rápido)
      const deletePromises = colecciones.map(colName => deleteCollection(colName));
      await Promise.all(deletePromises);
      
      console.log('✅ Todas las colecciones eliminadas.');

      // ===== LIMPIAR RTDB =====
      await limpiarRTDB();

      // Reiniciar configuración global
      const configRef = doc(db, 'config', 'global');
      await setDoc(configRef, {
        ...initialState,
        isInitialized: false,
        fechaFormateo: new Date().toISOString(),
        ultimoZ: 0,
        proximoRecibo: 1,
        proximaDevolucion: 1,
        proximaAnulacion: 1,
        acumuladoHistorico: 0,
        fechaUltimoZ: '',
        fondoCajaHoyUSD: 0,
        fondoCajaHoyBS: 0,
        tasa: state.tasa || 36.50,
        comisionEfectivo: state.comisionEfectivo || 5,
        empresa: {
          nombre: 'NOMBRE DE SU NEGOCIO',
          rif: 'J-00000000-0',
          direccion: 'DIRECCIÓN FISCAL',
          telefono: '0000-0000000'
        },
        departamentos: ['Licores', 'Viveres', 'Otros'],
        categorias: ['Ron', 'Vino', 'Cerveza', 'Whisky', 'Refrescos', 'Otros'],
        marcas: ['Genérica'],
        presentaciones: ['750ml', '1L', 'Unidad', 'Caja']
      });
      console.log('✅ Configuración global reiniciada.');

      // Limpiar almacenamiento local
      if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('posven_apertura_done');
        localStorage.removeItem('posven_last_cxp_alert');
      }

      toast({ 
        title: "✅ Sistema Formateado", 
        description: "Todos los datos (Firestore + RTDB) han sido eliminados. Redirigiendo al login...",
        duration: 2000
      });

      // Cerrar sesión INMEDIATAMENTE sin esperar
      try {
        await signOut(auth);
      } catch (e) {
        console.warn('⚠️ Error al cerrar sesión:', e);
      }

      // Redirigir al login inmediatamente
      window.location.href = '/login';

    } catch (error: any) {
      console.error("❌ Error en formateo:", error);
      toast({ 
        variant: "destructive", 
        title: "❌ Fallo en Limpieza", 
        description: error.message || "Hubo un error. Intente nuevamente." 
      });
      
      // Incluso si hay error, intentar redirigir
      try {
        await signOut(auth);
      } catch (e) {}
      window.location.href = '/login';
    } finally {
      setIsFormatting(false);
    }
  };

  const [isCleaningConfig, setIsCleaningConfig] = useState(false);

  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCrearRespaldo = async () => {
    setIsBackingUp(true);
    setBackupError(null);
    try {
      const backup = await crearRespaldo();
      descargarRespaldo(backup);
      toast({ title: "Respaldo Creado", description: "El archivo .json con todos los datos se descargó correctamente." });
    } catch (e: any) {
      console.error(e);
      setBackupError(e?.message || 'No fue posible crear el respaldo.');
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleArchivoRespaldo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupError(null);
    const confirmar = window.confirm('Se restaurará el sistema completo desde este respaldo. Los datos actuales serán reemplazados. ¿Desea continuar?');
    if (!confirmar) return;
    try {
      await cargarRespaldoDesdeArchivo(file);
      toast({ title: "Respaldo Restaurado", description: "El sistema fue restaurado correctamente. Se recomienda recargar la aplicación." });
    } catch (err: any) {
      console.error(err);
      setBackupError(err?.message || 'No se pudo cargar el respaldo seleccionado.');
    }
  };

  const limpiarConfigLocal = async () => {
    const confirmMsg =
      '¿Seguro que deseas limpiar los datos transaccionales guardados en config/global?\n\n' +
      'Se eliminarán SOLO los arrays heredados (ventas, movimientos, cxc, cxp, productos, etc.) dentro del documento config/global.\n\n' +
      '✅ Los datos de las colecciones raíz (Ventas, productos, movimientos, etc.) NO se tocan.\n\n' +
      '⚠️ Asegúrate de haber verificado/exportado tu información antes de continuar.';

    if (!confirm(confirmMsg)) return;

    setIsCleaningConfig(true);
    try {
      const count = await limpiarConfigGlobal();
      toast({
        title: count > 0 ? '✅ config/global limpiado' : 'ℹ️ Nada que limpiar',
        description: count > 0
          ? `Se eliminaron ${count} campos transaccionales de config/global.`
          : 'config/global ya solo contiene configuración.',
        duration: 3000
      });
    } catch (error) {
      console.warn('⚠️ Error al limpiar config/global:', error);
      toast({
        title: '❌ Error',
        description: 'No se pudo limpiar config/global.',
        duration: 3000
      });
    } finally {
      setIsCleaningConfig(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6 animate-in fade-in duration-300 pb-20">
      {/* ===== TASA DE CAMBIO ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest">Tasa de Cambio Oficial</h3>
        </div>
        <div className="card-body p-6 space-y-4 bg-white">
          <div className="form-group">
            <label className="text-ink text-[10px] font-black uppercase block mb-2 opacity-70">VALOR DE REFERENCIA: 1 USD =</label>
            <div className="flex items-center gap-4">
              <input 
                type="number" 
                step="0.01"
                className="form-input flex-1 h-12 text-xl font-black text-brand-gold-deep border-line bg-surface-soft/30 px-4 focus:ring-2 focus:ring-brand-gold focus:outline-none" 
                value={tasa} 
                onChange={e => setTasa(e.target.value)} 
              />
              <span className="text-ink font-black text-sm uppercase tracking-tighter">Bolívares (BS)</span>
            </div>
          </div>
          <button className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md mt-2" onClick={guardarTasa}>
            <Save className="w-4 h-4" /> Guardar Tasa Actualizada
          </button>
        </div>
      </div>

      {/* ===== COMISIÓN POR VENTA DE EFECTIVO ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest">Comisión por Venta de Efectivo</h3>
        </div>
        <div className="card-body p-6 space-y-4 bg-white">
          <div className="form-group">
            <label className="text-ink text-[10px] font-black uppercase block mb-2 opacity-70">PORCENTAJE DE COMISIÓN (%)</label>
            <div className="flex items-center gap-4">
              <input 
                type="number" 
                step="0.5"
                min="0"
                max="100"
                className="form-input flex-1 h-12 text-xl font-black text-brand-gold-deep border-line bg-surface-soft/30 px-4 focus:ring-2 focus:ring-brand-gold focus:outline-none" 
                value={comision} 
                onChange={e => setComision(e.target.value)} 
              />
              <span className="text-ink font-black text-sm uppercase tracking-tighter">%</span>
            </div>
            <p className="text-[8px] text-ink/40 mt-2">
              Porcentaje que se cobra al cliente por el servicio de venta de efectivo en bolívares.
              Ej: 5% = Bs. 500.000 en efectivo se cobra Bs. 525.000
            </p>
          </div>
          <button className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md mt-2" onClick={guardarComision}>
            <Save className="w-4 h-4" /> Guardar Comisión
          </button>
        </div>
      </div>

      {/* ===== SEGURIDAD ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest">Seguridad de Operaciones</h3>
        </div>
        <div className="card-body p-6 bg-white">
          <div className="form-group">
            <label className="text-ink text-[10px] font-black uppercase block mb-2 opacity-70">PIN de Autorización (6 Dígitos)</label>
            <input 
              type="password" 
              maxLength={6}
              className="form-input h-14 text-2xl font-black text-brand-gold-deep border-line bg-surface-soft/30 text-center tracking-[0.5em] focus:ring-2 focus:ring-brand-gold focus:outline-none" 
              value={pinDevolucion} 
              onChange={e => {
                const cleaned = e.target.value.replace(/\D/g, '');
                setPinDevolucion(cleaned);
              }} 
            />
            <p className="text-[8px] text-ink/40 mt-1">Ingrese 6 dígitos numéricos</p>
          </div>
          <button className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md mt-4" onClick={guardarPin}>
            <Save className="w-4 h-4" /> Establecer PIN
          </button>
        </div>
      </div>

      {/* ===== DATOS FISCALES ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest">Datos de Identidad Fiscal</h3>
        </div>
        <div className="card-body p-6 space-y-5 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Nombre del Negocio</label>
              <input 
                className="form-input h-10 font-bold border-line focus:ring-2 focus:ring-brand-gold focus:outline-none" 
                value={empresa.nombre} 
                onChange={e => setEmpresa({...empresa, nombre: e.target.value})} 
              />
            </div>
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Número de RIF</label>
              <input 
                className="form-input h-10 font-black border-line uppercase focus:ring-2 focus:ring-brand-gold focus:outline-none" 
                value={empresa.rif} 
                onChange={e => setEmpresa({...empresa, rif: e.target.value})} 
              />
            </div>
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Teléfono de Contacto</label>
              <input 
                className="form-input h-10 font-bold border-line focus:ring-2 focus:ring-brand-gold focus:outline-none" 
                value={empresa.telefono} 
                onChange={e => setEmpresa({...empresa, telefono: e.target.value})} 
              />
            </div>
            <div className="form-group">
              <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-70">Dirección Fiscal</label>
              <input 
                className="form-input h-10 font-bold border-line uppercase focus:ring-2 focus:ring-brand-gold focus:outline-none" 
                value={empresa.direccion} 
                onChange={e => setEmpresa({...empresa, direccion: e.target.value})} 
              />
            </div>
          </div>
          <button className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md" onClick={guardarEmpresa}>
            <Save className="w-4 h-4" /> Actualizar Empresa
          </button>
        </div>
      </div>

      {/* ===== ZONA DE SEGURIDAD CRÍTICA ===== */}
      <div className="card border-status-danger/30 bg-status-danger-soft">
        <div className="card-head border-b border-status-danger/20 px-5 py-4">
          <h3 className="text-status-danger font-black uppercase italic text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Zona de Seguridad Crítica
          </h3>
        </div>
        <div className="card-body p-6">
          <p className="text-xs text-ink font-bold mb-5 uppercase">
            ESTA ACCIÓN ELIMINARÁ TODOS LOS DATOS DEL SISTEMA DE MANERA PERMANENTE.
          </p>
          <div className="flex flex-wrap gap-3">
            <button 
              className="btn btn-danger h-12 px-8 font-black uppercase text-xs shadow-xl flex items-center gap-2" 
              onClick={formatearSistema}
              disabled={isFormatting}
            >
              {isFormatting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
              {isFormatting ? 'FORMATEANDO...' : 'Limpiar Todo el Sistema'}
            </button>
            <button 
              className="btn h-12 px-6 font-black uppercase text-xs shadow-md flex items-center gap-2 border border-status-danger/40 text-status-danger bg-white hover:bg-status-danger-soft" 
              onClick={limpiarConfigLocal}
              disabled={isCleaningConfig}
            >
              <RefreshCw className={`w-4 h-4 ${isCleaningConfig ? 'animate-spin' : ''}`} />
              {isCleaningConfig ? 'LIMPIANDO...' : 'Limpiar config/global (seguro)'}
            </button>
          </div>
        </div>
      </div>

      {/* ===== RESPALDO DE DATOS ===== */}
      <div className="card shadow-lg border-line">
        <div className="card-head bg-surface-soft border-b border-line px-5 py-4">
          <h3 className="text-ink font-black uppercase text-xs tracking-widest flex items-center gap-2">
            <Database className="w-4 h-4" /> Respaldo de Datos
          </h3>
        </div>
        <div className="card-body p-6 space-y-4 bg-white">
          <p className="text-xs text-ink font-bold">
            Cree un respaldo completo del sistema (inventario, ventas, cuentas por cobrar/pagar, clientes, proveedores, usuarios, terminales, catálogos y configuración) como archivo <code className="font-mono">.json</code>. Puede restaurarlo posteriormente en este mismo equipo o en otro.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              className="btn btn-primary h-12 px-8 font-black uppercase text-xs shadow-md flex items-center gap-2"
              onClick={handleCrearRespaldo}
              disabled={isBackingUp}
            >
              {isBackingUp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isBackingUp ? 'PREPARANDO RESPALDO...' : 'Crear Respaldo'}
            </button>

            <button
              className="btn h-12 px-8 font-black uppercase text-xs shadow-md flex items-center gap-2 border border-line bg-surface-soft/50 hover:bg-surface-soft"
              onClick={() => fileInputRef.current?.click()}
            >
              <Database className="w-4 h-4" />
              Cargar Respaldo
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleArchivoRespaldo}
          />

          {backupError && (
            <div className="p-4 rounded-lg border bg-red-50 border-red-500">
              <p className="text-xs text-red-700 font-black uppercase">Error al cargar el respaldo</p>
              <p className="text-xs text-red-700 mt-1">{backupError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}