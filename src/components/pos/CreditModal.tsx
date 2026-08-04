'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Search, CreditCard, User, UserPlus, AlertCircle } from 'lucide-react';
import { Customer, Debt } from '@/lib/types';
import { Store } from '@/lib/db-store';
import { formatUsd } from '@/lib/currency-formatter';
import { useToast } from '@/hooks/use-toast';

// ============================================================
// UTILIDADES DE NORMALIZACIÓN DE CÉDULA (integradas)
// ============================================================

/**
 * Normaliza una cédula según el tipo de documento
 * - Para V- y E-: formato con puntos (XX.XXX.XXX)
 * - Para J-, G-, P-: solo dígitos sin formato
 */
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
  
  if (!type) {
    type = 'V-';
  }
  
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

function sameCedula(cedula1: string, cedula2: string): boolean {
  return getRawCedula(cedula1) === getRawCedula(cedula2);
}

function extractDocType(cedula: string): string {
  const match = cedula.match(/^([A-Z]-?)/);
  return match ? match[1].replace('-', '').trim() + '-' : 'V-';
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

interface CreditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (customer: Customer, amount: number) => void;
  totalAmount: number;
  clients?: Customer[];
  debts?: Debt[];
}

export function CreditModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  totalAmount,
  clients: propClients,
  debts: propDebts,
}: CreditModalProps) {
  const { toast } = useToast();
  const [store, setStore] = useState<any>(Store.get());

  const [view, setView] = useState<'search' | 'found' | 'create'>('search');
  const [docType, setDocType] = useState('V-');
  const [docNumber, setDocNumber] = useState('');
  const [searchName, setSearchName] = useState('');
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(null);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const [nameMatches, setNameMatches] = useState<Customer[]>([]);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const docSelectRef = useRef<HTMLSelectElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const phoneInputRef = useRef<HTMLInputElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const getClients = (): Customer[] => propClients || store.clientes || [];
  const getDebts = (): Debt[] => propDebts || store.cxc || [];

  useEffect(() => {
    const unsubscribe = Store.subscribe(setStore);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isOpen) {
      setView('search');
      setDocType('V-');
      setDocNumber('');
      setSearchName('');
      setNameMatches([]);
      setFoundCustomer(null);
      setNewName('');
      setNewPhone('');
      setNewAddress('');
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    if (view === 'found' && confirmButtonRef.current) {
      setTimeout(() => confirmButtonRef.current?.focus(), 100);
    }
  }, [view]);

  const handleDocNumberChange = (value: string) => {
    const clean = value.replace(/[^0-9]/g, '');
    const formatted = normalizeCedula(clean, docType);
    setDocNumber(formatted);
    if (formatted) {
        setSearchName('');
        setNameMatches([]);
    }
  };

  const handleDocTypeChange = (type: string) => {
    setDocType(type);
    if (docNumber) {
      const cleanNumber = docNumber.replace(/[^0-9]/g, '');
      const formatted = normalizeCedula(cleanNumber, type);
      setDocNumber(formatted);
    }
  };

  const findCustomer = (fullDoc: string): Customer | null => {
    const raw = getRawCedula(fullDoc);
    const customers = getClients();
    const debts = getDebts();
    let customer: Customer | null = customers.find(c => getRawCedula(c.cedula) === raw) ? { ...customers.find(c => getRawCedula(c.cedula) === raw)! } : null;

    const deudasCliente = debts.filter(d => {
      if (!d.cliente) return false;
      const match = d.cliente.match(/^(.*?)\s*\[(.*?)\]$/);
      return match && getRawCedula(match[2]) === raw;
    });
    const totalDeuda = deudasCliente.reduce((sum, d) => sum + (d.saldoUSD || 0), 0);

    if (!customer && deudasCliente.length > 0) {
      const primera = deudasCliente[0];
      const match = primera.cliente?.match(/^(.*?)\s*\[(.*?)\]$/);
      if (match) {
        const tipo = extractDocType(fullDoc);
        const cedulaNormalizada = normalizeCedula(match[2], tipo);
        customer = {
          id: `CUS-${Date.now()}`,
          name: match[1].trim(),
          cedula: cedulaNormalizada,
          address: 'Sin dirección',
          phone: 'Sin teléfono',
          debt: totalDeuda
        };
      }
    } else if (customer) {
      customer.debt = totalDeuda;
    }
    return customer;
  };
  
  const handleSelectMatch = (customer: Customer) => {
    const fullCustomerProfile = findCustomer(customer.cedula);
    setFoundCustomer(fullCustomerProfile);
    setView('found');
    setNameMatches([]);
    setSearchName('');
  };

  const handleSearch = () => {
    const trimmedDoc = docNumber.trim();
    const trimmedName = searchName.trim();

    if (!trimmedDoc && !trimmedName) {
      toast({ title: "Criterio Requerido", description: "Por favor, ingrese un documento o un nombre.", variant: "destructive" });
      return;
    }

    if (trimmedDoc) {
      const cleanDoc = trimmedDoc.replace(/\./g, '');
      const fullDoc = `${docType}${cleanDoc}`;
      const customer = findCustomer(fullDoc);
      if (customer) {
        setFoundCustomer(customer);
        setView('found');
      } else {
        setFoundCustomer(null);
        setView('create');
      }
    } else if (trimmedName) {
      const customers = getClients();
      const nameToSearch = trimmedName.toLowerCase();
      const foundCustomers = customers.filter(c => c.name.toLowerCase().includes(nameToSearch));

      if (foundCustomers.length === 1) {
        handleSelectMatch(foundCustomers[0]);
      } else if (foundCustomers.length > 1) {
        setNameMatches(foundCustomers);
      } else {
        toast({ 
          title: "Cliente no encontrado", 
          description: `No se encontró un cliente que coincida con "${trimmedName}". Intente con el documento de identidad.`,
          variant: "destructive" 
        });
        setNameMatches([]);
      }
    }
  };

  const handleConfirmCharge = () => {
    if (foundCustomer) {
      const customers = getClients();
      const exists = customers.some(c => getRawCedula(c.cedula) === getRawCedula(foundCustomer.cedula));
      
      if (!exists) {
        const cedulaNormalizada = normalizeCedula(foundCustomer.cedula, extractDocType(foundCustomer.cedula));
        const newCustomer: Customer = {
          id: `CUS-${Date.now()}`,
          name: foundCustomer.name,
          cedula: cedulaNormalizada,
          address: foundCustomer.address || 'Sin dirección',
          phone: foundCustomer.phone || 'Sin teléfono',
          debt: foundCustomer.debt || 0
        };
        const updatedCustomers = [...customers, newCustomer];
        Store.set({ ...store, clientes: updatedCustomers });
        setFoundCustomer({ ...newCustomer });
        onConfirm(newCustomer, totalAmount);
      } else {
        onConfirm(foundCustomer, totalAmount);
      }
    }
  };
  
  const handleCreateAndCharge = () => {
    const cleanDoc = docNumber.replace(/\./g, '');
    const fullDoc = `${docType}${cleanDoc}`;
    const normalizedCedula = normalizeCedula(fullDoc);
    const raw = getRawCedula(normalizedCedula);
    
    if (!newName.trim() || !fullDoc) {
      toast({ title: "Campos Incompletos", description: "El nombre y la identificación son obligatorios.", variant: "destructive" });
      return;
    }

    const customers = getClients();
    const debts = getDebts();
    const exists = customers.some(c => getRawCedula(c.cedula) === raw) ||
                   debts.some(d => {
                     if (!d.cliente) return false;
                     const match = d.cliente.match(/^(.*?)\s*\[(.*?)\]$/);
                     return match && getRawCedula(match[2]) === raw;
                   });

    if (exists) {
      toast({ 
        title: "Cliente ya existe", 
        description: `Ya existe un cliente con el documento ${normalizedCedula}`,
        variant: "destructive"
      });
      return;
    }

    const newCustomer: Customer = {
      id: `CUS-${Date.now()}`,
      cedula: normalizedCedula,
      name: newName.trim().toUpperCase(),
      phone: newPhone.trim(),
      address: newAddress.trim(),
      debt: 0
    };
    
    const updatedCustomers = [...customers, newCustomer];
    Store.set({ ...store, clientes: updatedCustomers });

    toast({ title: "Cliente Creado", description: `Se ha registrado a ${newName}. Procediendo a cargar el crédito.` });
    
    onConfirm(newCustomer, totalAmount);
  };

  const handleBackToSearch = () => {
    setView('search');
    setFoundCustomer(null);
    setDocNumber('');
    setNewName('');
    setNewPhone('');
    setNewAddress('');
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  const handleKeyDownCreate = (e: React.KeyboardEvent<HTMLInputElement>, field: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      switch (field) {
        case 'name': docInputRef.current?.focus(); break;
        case 'doc': phoneInputRef.current?.focus(); break;
        case 'phone': addressInputRef.current?.focus(); break;
        case 'address': createButtonRef.current?.click(); break;
        default: break;
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4 animate-in fade-in-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md transform transition-all duration-300 overflow-hidden max-h-[95vh] flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200 flex justify-between items-center bg-black shrink-0">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#D4A017]" />
            <h2 className="text-base font-bold text-white">CARGAR CRÉDITO</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-white/60 hover:text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
          <div className="bg-black rounded-xl p-3 text-center shrink-0">
            <p className="text-[10px] font-bold text-white/60 uppercase">Monto a deber</p>
            <p className="text-2xl font-black text-[#D4A017]">{formatUsd(totalAmount)}</p>
          </div>

          {view === 'search' && (
            <div className="space-y-3">
                <div>
                    <label htmlFor="doc-input" className="block text-[10px] font-bold text-gray-500">Documento de Identidad</label>
                    <div className="flex items-center gap-2 mt-1">
                        <select 
                            value={docType} 
                            onChange={e => handleDocTypeChange(e.target.value)} 
                            className="h-9 bg-gray-100 border border-gray-300 rounded-lg px-2 font-bold text-gray-700 focus:ring-2 focus:ring-[#D4A017] outline-none text-sm w-[70px]"
                        >
                            <option>V-</option> <option>E-</option> <option>J-</option> <option>G-</option>
                        </select>
                        <input
                            ref={searchInputRef}
                            id="doc-input"
                            type="text"
                            value={docNumber}
                            onChange={(e) => handleDocNumberChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            placeholder={docType === 'V-' || docType === 'E-' ? "XX.XXX.XXX" : "Número de identificación"}
                            className="flex-1 h-9 px-3 bg-white border border-gray-300 rounded-lg font-medium focus:ring-2 focus:ring-[#D4A017] outline-none text-sm"
                        />
                    </div>
                </div>

                <div className="relative flex items-center py-1">
                    <div className="flex-grow border-t border-gray-200"></div>
                    <span className="flex-shrink mx-2 text-xs text-gray-400">O</span>
                    <div className="flex-grow border-t border-gray-200"></div>
                </div>

                <div>
                    <label htmlFor="name-search-input" className="block text-[10px] font-bold text-gray-500">Buscar por Nombre de Cliente</label>
                    <input
                        id="name-search-input"
                        type="text"
                        value={searchName}
                        onChange={(e) => {
                            setSearchName(e.target.value);
                            if (e.target.value) setDocNumber('');
                            else setNameMatches([]);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="Ej: Juan Perez"
                        className="w-full h-9 px-3 mt-1 bg-white border border-gray-300 rounded-lg font-medium focus:ring-2 focus:ring-[#D4A017] outline-none text-sm"
                    />
                </div>

                {nameMatches.length > 0 && (
                    <div className="space-y-2 pt-3 mt-3 border-t border-gray-200 animate-in fade-in duration-300">
                        <p className="text-xs font-bold text-gray-600">Múltiples coincidencias. Por favor, seleccione un cliente:</p>
                        <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                            {nameMatches.map(match => (
                                <button 
                                    key={match.id} 
                                    onClick={() => handleSelectMatch(match)}
                                    className="w-full text-left p-2.5 bg-gray-50 hover:bg-blue-100 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-150"
                                >
                                    <p className="font-bold text-sm text-gray-800 uppercase">{match.name}</p>
                                    <p className="text-xs text-gray-500 font-mono">{match.cedula}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex justify-end items-center gap-2 pt-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg font-bold hover:bg-gray-300 transition-colors text-sm"
                    >
                        Cancelar
                    </button>
                    <button 
                        onClick={handleSearch} 
                        className="h-9 px-4 bg-blue-600 text-white rounded-lg font-bold flex items-center justify-center hover:bg-blue-700 transition-all shrink-0 gap-2"
                    >
                        <Search className="w-4 h-4" />
                        <span>Buscar</span>
                    </button>
                </div>
            </div>
          )}

          {view === 'found' && foundCustomer && (
            <div className="space-y-3 animate-in zoom-in-95 duration-300">
              <div className="bg-gray-50 rounded-xl p-3 text-center border border-gray-200">
                <p className="font-bold text-base text-gray-800">{foundCustomer.name}</p>
                <p className="text-sm text-gray-500 mt-1">
                  SALDO ACTUAL: <span className="font-bold text-red-600">{formatUsd(foundCustomer.debt || 0)}</span>
                  {(foundCustomer.debt || 0) === 0 && (
                    <span className="ml-2 text-xs text-green-600 font-bold">(AL DÍA)</span>
                  )}
                </p>
                {foundCustomer.debt !== undefined && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Equiv. Bs: <span className="font-bold">{((foundCustomer.debt || 0) * (store.tasa || 1)).toFixed(2)}</span>
                  </p>
                )}
              </div>
              <button
                ref={confirmButtonRef}
                onClick={handleConfirmCharge}
                onKeyDown={(e) => e.key === 'Enter' && handleConfirmCharge()}
                className="w-full h-11 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-bold text-base hover:shadow-lg transition-all flex items-center justify-center gap-2 focus:ring-2 focus:ring-blue-400 focus:outline-none"
              >
                <CreditCard className="w-4 h-4" />
                CARGAR CRÉDITO
              </button>
            </div>
          )}

          {view === 'create' && !foundCustomer && (
            <div className="space-y-3 animate-in zoom-in-95 duration-300">
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center">
                <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-1" />
                <p className="font-bold text-yellow-700 text-sm">Cliente no encontrado</p>
                <p className="text-xs text-yellow-600 mt-0.5">
                  No existe un cliente con el documento {docType}{docNumber.replace(/\./g, '')}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleBackToSearch}
                  className="flex-1 h-9 bg-gray-200 text-gray-700 rounded-lg font-bold hover:bg-gray-300 transition-colors text-sm"
                >
                  Volver a Buscar
                </button>
                <button
                  onClick={() => setView('create')} // Cambiar la vista a 'create' para mostrar el formulario
                  className="flex-1 h-9 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-1 text-sm"
                >
                  <UserPlus className="w-4 h-4" />
                  Sí, Crear Cliente
                </button>
              </div>
            </div>
          )}
          
          {view === 'create' && (
            <div className="space-y-2 animate-in fade-in duration-300">
              <p className="text-center text-sm font-bold text-gray-700 pt-2">Nuevo Cliente</p>
              
              <div>
                <label className="text-[10px] font-bold text-gray-500 block mb-0.5">NOMBRE COMPLETO</label>
                <input 
                  ref={nameInputRef}
                  type="text" 
                  value={newName} 
                  onChange={e => setNewName(e.target.value)} 
                  onKeyDown={(e) => handleKeyDownCreate(e, 'name')}
                  className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm uppercase" 
                  placeholder="GLORIA MACHETE"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 block mb-0.5">CÉDULA / IDENTIFICACIÓN</label>
                <div className="flex items-center gap-2">
                  <select 
                    ref={docSelectRef}
                    value={docType} 
                    onChange={e => handleDocTypeChange(e.target.value)} 
                    className="px-2 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-bold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm w-[70px]"
                  >
                    <option>V-</option><option>E-</option><option>J-</option><option>G-</option>
                  </select>
                  <input 
                    ref={docInputRef}
                    type="text" 
                    value={docNumber} 
                    onChange={(e) => handleDocNumberChange(e.target.value)} 
                    onKeyDown={(e) => handleKeyDownCreate(e, 'doc')}
                    className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm" 
                    placeholder={docType === 'V-' || docType === 'E-' ? "XX.XXX.XXX" : "Número de identificación"}
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 block mb-0.5">TELÉFONO</label>
                <input 
                  ref={phoneInputRef}
                  type="tel" 
                  value={newPhone} 
                  onChange={e => setNewPhone(e.target.value)} 
                  onKeyDown={(e) => handleKeyDownCreate(e, 'phone')}
                  className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm" 
                  placeholder="04125896659"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-500 block mb-0.5">DIRECCIÓN</label>
                <input 
                  ref={addressInputRef}
                  type="text" 
                  value={newAddress} 
                  onChange={e => setNewAddress(e.target.value)} 
                  onKeyDown={(e) => handleKeyDownCreate(e, 'address')}
                  className="w-full px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg font-semibold focus:ring-2 focus:ring-[#D4A017] outline-none text-sm" 
                  placeholder="Dirección del cliente"
                />
              </div>
              <div className="flex flex-col gap-1.5 pt-1">
                <button 
                  ref={createButtonRef}
                  onClick={handleCreateAndCharge} 
                  className="w-full h-10 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-xl font-bold hover:shadow-lg transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <UserPlus className="w-4 h-4" />
                  GUARDAR Y CARGAR
                </button>
                <button 
                  onClick={handleBackToSearch} 
                  className="font-bold text-gray-600 hover:underline text-xs text-center"
                >
                  VOLVER A LA BÚSQUEDA
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}