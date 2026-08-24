"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { AppState, Supplier } from '@/lib/types';
import { Utils, Store, Collections, PROVIDERS_COLLECTION } from '@/lib/db-store';
import { 
  Truck, 
  Plus, 
  X, 
  Save, 
  Trash2, 
  Edit2, 
  Search,
  ClipboardList,
  AlertTriangle,
  User,
  Hash,
  MapPin,
  Phone
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';

export default function SuppliersModule({ state, updateState }: { state: AppState, updateState: (s: Partial<AppState>) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Estado local de proveedores (se sincroniza con Firestore)
  const [proveedores, setProveedores] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [formData, setFormData] = useState({
    nombre: '',
    rif: 'J-',
    contacto: '',
    direccion: '',
    telefono: ''
  });

  // Cargar proveedores desde la colección raíz
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    
    const loadProveedores = async () => {
      try {
        const lista = await Collections.getAll(PROVIDERS_COLLECTION);
        setProveedores(lista as Supplier[]);
        // Actualizar el estado global también
        updateState({ proveedores: lista as Supplier[] });
        setLoading(false);
      } catch (error) {
        console.error('Error cargando proveedores:', error);
        setLoading(false);
      }
    };

    // Suscribirse en tiempo real
    unsubscribe = Collections.subscribeAll(PROVIDERS_COLLECTION, (list) => {
      const suppliers = list as Supplier[];
      setProveedores(suppliers);
      updateState({ proveedores: suppliers });
      setLoading(false);
    });

    loadProveedores();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Normalización de proveedores para evitar errores de tipo
  const safeProveedores = useMemo(() => {
    return proveedores.map(p => 
      typeof p === 'string' ? { id: p, nombre: p, rif: p, contacto: '', direccion: '', telefono: '' } : p
    );
  }, [proveedores]);

  const filtered = safeProveedores.filter(p => 
    (p.nombre || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.rif || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async () => {
    if (!formData.nombre.trim() || !formData.rif.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Nombre y RIF son obligatorios"
      });
      return;
    }
    
    const rifLimpio = formData.rif.trim().toUpperCase();
    
    // Verificar si el RIF ya existe en otro proveedor (distinto al que estamos editando)
    const existeRif = safeProveedores.find(p => p.rif === rifLimpio && p.id !== editingId);
    
    if (existeRif) {
      toast({ 
        variant: "destructive", 
        title: "RIF ya registrado", 
        description: `El RIF ${rifLimpio} ya pertenece al proveedor: ${existeRif.nombre}` 
      });
      return;
    }

    const nuevoProveedor: Supplier = {
      ...formData,
      id: editingId || rifLimpio,
      rif: rifLimpio,
      nombre: formData.nombre.trim()
    };

    try {
      // Guardar en la colección raíz
      await Collections.set(PROVIDERS_COLLECTION, nuevoProveedor.id, nuevoProveedor);
      
      // Actualizar productos que referencian a este proveedor por nombre (solo si es edición)
      if (editingId) {
        const viejoNombre = safeProveedores.find(p => p.id === editingId)?.nombre || '';
        if (viejoNombre && viejoNombre !== formData.nombre) {
          const productosActualizados = state.productos.map(p => 
            p.proveedor === viejoNombre ? { ...p, proveedor: formData.nombre } : p
          );
          // Actualizar productos en Firestore
          for (const prod of productosActualizados) {
            await Collections.set('productos', prod.id, prod);
          }
          updateState({ productos: productosActualizados });
        }
      }
      
      toast({ 
        title: editingId ? "Proveedor Actualizado" : "Proveedor Registrado", 
        description: editingId ? "Cambios guardados correctamente." : `Se ha añadido ${formData.nombre} al sistema.` 
      });
      
      setShowModal(false);
      setEditingId(null);
      setFormData({ nombre: '', rif: 'J-', contacto: '', direccion: '', telefono: '' });
    } catch (error) {
      console.error('Error guardando proveedor:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo guardar el proveedor. Intente nuevamente."
      });
    }
  };

  const handleEdit = (p: Supplier) => {
    setEditingId(p.id);
    setFormData({
      nombre: p.nombre,
      rif: p.rif,
      contacto: p.contacto,
      direccion: p.direccion,
      telefono: p.telefono
    });
    setShowModal(true);
  };

  const handleDelete = async (p: Supplier) => {
    if (!confirm(`¿Seguro que desea eliminar a "${p.nombre}"?`)) return;
    
    try {
      await Collections.delete(PROVIDERS_COLLECTION, p.id);
      toast({ title: "Proveedor Eliminado" });
    } catch (error) {
      console.error('Error eliminando proveedor:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo eliminar el proveedor."
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-brand-gold/20 border-t-brand-gold rounded-full animate-spin" />
        <span className="ml-3 text-sm font-black text-ink/40">Cargando proveedores...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h2 className="text-ink font-black uppercase italic tracking-tighter text-2xl flex items-center gap-2">
            <Truck className="text-brand-gold w-7 h-7" /> GESTIÓN DE PROVEEDORES
          </h2>
          <p className="text-[10px] text-ink font-bold uppercase tracking-widest opacity-60">Fichas Fiscales y Aliados Comerciales</p>
        </div>
        <button 
          onClick={() => { setEditingId(null); setFormData({ nombre: '', rif: 'J-', contacto: '', direccion: '', telefono: '' }); setShowModal(true); }} 
          className="btn btn-primary h-11 px-6 font-black uppercase text-xs flex items-center gap-2 shadow-lg"
        >
          <Plus className="w-4 h-4" /> Nuevo Proveedor
        </button>
      </div>

      <div className="card shadow-lg border-line rounded-xl overflow-hidden bg-white">
        <div className="card-head bg-ink border-b border-white/10 px-6 py-4 flex flex-wrap justify-between items-center gap-4">
          <h3 className="text-white font-black text-xs uppercase italic tracking-tighter flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-brand-gold" /> DIRECTORIO DE PROVEEDORES
          </h3>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-ink opacity-30" />
            <input 
              className="form-input pl-10 h-9 text-xs font-bold uppercase" 
              placeholder="Buscar por Nombre o RIF..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        
        <div className="table-wrap">
          <table>
            <thead>
              <tr className="bg-surface-soft">
                <th className="text-ink font-black text-[10px] uppercase py-4 px-6 border-b border-line">Proveedor / RIF</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 px-6 border-b border-line">Contacto</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 px-6 border-b border-line text-center">Teléfono</th>
                <th className="text-ink font-black text-[10px] uppercase py-4 px-6 border-b border-line text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-20 text-ink/20 font-black uppercase italic">No se registran proveedores coincidentes</td></tr>
              ) : (
                filtered.map((p, idx) => (
                  <tr key={`${p.id}-${idx}`} className="border-b border-line/30 hover:bg-surface-warm/20 transition-colors">
                    <td className="py-4 px-6">
                       <div className="text-ink font-black text-xs uppercase">{p.nombre}</div>
                       <div className="text-brand-gold-deep font-black text-[9px] mono">{p.rif}</div>
                    </td>
                    <td className="text-ink font-bold text-xs uppercase py-4 px-6">{p.contacto || 'No especificado'}</td>
                    <td className="text-center py-4 px-6">
                      <span className="badge badge-neutral font-black px-3">{p.telefono || '-'}</span>
                    </td>
                    <td className="text-right py-4 px-6">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleEdit(p)} className="btn-icon h-8 w-8 text-ink hover:text-brand-gold" title="Modificar Datos"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(p)} className="btn-icon h-8 w-8 text-ink hover:text-status-danger" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal show"><div className="modal-bg" onClick={() => setShowModal(false)}></div>
          <div className="modal-box bg-white max-w-lg border-2 border-line shadow-2xl rounded-2xl overflow-hidden">
            <div className="modal-head py-4 px-6 border-b border-line bg-ink flex justify-between items-center">
              <h3 className="text-white font-black uppercase text-xs italic tracking-widest">
                {editingId ? 'EDITAR PROVEEDOR' : 'REGISTRAR NUEVO PROVEEDOR'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-white/40 hover:text-white"><X className="w-5 h-5"/></button>
            </div>
            <div className="modal-body p-8 space-y-6">
               <div className="grid grid-cols-2 gap-5">
                  <div className="form-group col-span-2 sm:col-span-1">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-60">Nombre Comercial</label>
                    <div className="relative">
                      <Truck className="absolute left-3 top-3 w-4 h-4 text-brand-gold opacity-30" />
                      <input className="form-input pl-10 h-11 text-xs font-black uppercase" value={formData.nombre} onChange={e => setFormData({...formData, nombre: e.target.value})} placeholder="NOMBRE DE LA EMPRESA" />
                    </div>
                  </div>
                  <div className="form-group col-span-2 sm:col-span-1">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-60">RIF Fiscal (ID ÚNICO)</label>
                    <div className="relative">
                      <Hash className="absolute left-3 top-3 w-4 h-4 text-brand-gold opacity-30" />
                      <input className="form-input pl-10 h-11 text-xs font-black uppercase" value={formData.rif} onChange={e => setFormData({...formData, rif: e.target.value})} placeholder="J-12345678-0" />
                    </div>
                  </div>
               </div>

               <div className="grid grid-cols-2 gap-5">
                  <div className="form-group col-span-2 sm:col-span-1">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-60">Persona de Contacto</label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 w-4 h-4 text-brand-gold opacity-30" />
                      <input className="form-input pl-10 h-11 text-xs font-black uppercase" value={formData.contacto} onChange={e => setFormData({...formData, contacto: e.target.value})} placeholder="NOMBRE DEL VENDEDOR" />
                    </div>
                  </div>
                  <div className="form-group col-span-2 sm:col-span-1">
                    <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-60">Teléfono</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 w-4 h-4 text-brand-gold opacity-30" />
                      <input className="form-input pl-10 h-11 text-xs font-black uppercase" value={formData.telefono} onChange={e => setFormData({...formData, telefono: e.target.value})} placeholder="0412-0000000" />
                    </div>
                  </div>
               </div>

               <div className="form-group">
                  <label className="text-ink text-[10px] font-black uppercase block mb-1.5 opacity-60">Dirección Fiscal / Oficina</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-4 h-4 text-brand-gold opacity-30" />
                    <textarea className="form-input pl-10 py-3 text-xs font-bold uppercase min-h-[80px]" value={formData.direccion} onChange={e => setFormData({...formData, direccion: e.target.value})} placeholder="DIRECCIÓN COMPLETA..."></textarea>
                  </div>
               </div>

               <div className="p-4 bg-brand-gold-soft/20 rounded-xl border border-brand-gold/10 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-brand-gold-deep shrink-0 mt-0.5" />
                  <p className="text-[9px] text-brand-gold-deep font-bold uppercase leading-tight">El RIF es el identificador único del proveedor. No se permite duplicidad por seguridad fiscal.</p>
               </div>

               <button onClick={handleSave} className="btn btn-primary w-full h-14 font-black uppercase text-xs shadow-xl tracking-widest">
                <Save className="w-5 h-5 mr-2" /> {editingId ? 'GUARDAR CAMBIOS' : 'REGISTRAR ALIADO'}
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}