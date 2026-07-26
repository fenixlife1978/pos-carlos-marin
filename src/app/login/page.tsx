"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, UserPlus, LogIn } from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onAuthStateChanged, 
  setPersistence, 
  browserSessionPersistence, 
  signOut 
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { toast } from '../../hooks/use-toast';
import { Store, initialState } from '@/lib/db-store';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [systemEmpty, setSystemEmpty] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!authChecked) setAuthChecked(true);
    }, 8000);

    const checkSystemStatus = async () => {
      if (!db) return;
      try {
        const usersCollection = collection(db, 'users');
        const userSnapshot = await getDocs(usersCollection);
        setSystemEmpty(userSnapshot.empty);
        
        if (userSnapshot.empty) {
          setIsRegistering(true);
          setRole('administrador');
        }

      } catch (e) {
        console.warn("Error chequeando estado del sistema:", e);
        setSystemEmpty(false);
      }
    };

    const checkAuth = async () => {
        if (!auth) {
            setAuthChecked(true);
            return;
        }
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                try {
                    const userDoc = await getDoc(doc(db, 'users', user.uid));
                    if (userDoc.exists() && !userDoc.data().accesoBloqueado) {
                        router.push('/');
                    } else {
                        if (userDoc.exists()) {
                            toast({
                                variant: "destructive",
                                title: "Acceso Bloqueado",
                                description: "Su cuenta está suspendida."
                            });
                        }
                        await signOut(auth);
                        setAuthChecked(true);
                    }
                } catch (e) {
                    await signOut(auth);
                    setAuthChecked(true);
                }
            } else {
                setAuthChecked(true);
            }
        });
    };
    
    Promise.all([checkSystemStatus(), checkAuth()]).finally(() => {
        setAuthChecked(true);
        clearTimeout(timer);
    });

    return () => clearTimeout(timer);
  }, [router]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (systemEmpty && !isRegistering) {
        setLoading(true);
        toast({
            title: "Acceso de Emergencia Activado",
            description: "No se detectaron usuarios. Accediendo como Administrador temporal.",
            variant: "default",
        });

        const currentState = Store.get();
        Store.set({
            ...currentState,
            user: {
                nombre: "ADMIN DE EMERGENCIA",
                email: "temp@local.host",
                rol: "administrador",
                uid: "temp-admin-user",
                accesoBloqueado: false,
            },
            isAuthenticated: true,
        });
        
        router.push('/');
        return;
    }

    if (!role && isRegistering) {
      toast({ variant: "destructive", title: "Atención", description: "Debe seleccionar un rol para el nuevo usuario." });
      return;
    }
    setLoading(true);

    try {
      if (!auth || !db) throw new Error("Servicios de Firebase no disponibles");
      await setPersistence(auth, browserSessionPersistence);
      
      let user;
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        user = userCredential.user;

        const newUserData = {
          email: user.email!.toLowerCase(),
          nombre: email.split('@')[0].toUpperCase(),
          rol: role,
          uid: user.uid,
          fechaCreacion: new Date().toISOString(),
          accesoBloqueado: false
        };
        await setDoc(doc(db, 'users', user.uid), newUserData);

        // 🔑 SI ES EL PRIMER USUARIO, CREAR CONFIGURACIÓN GLOBAL
        if (systemEmpty) {
            // Crear config/global con valores iniciales
            const configRef = doc(db, 'config', 'global');
            await setDoc(configRef, {
              tasa: initialState.tasa,
              comisionEfectivo: initialState.comisionEfectivo,
              pinDevolucion: initialState.pinDevolucion,
              isInitialized: true,
              empresa: initialState.empresa,
              departamentos: initialState.departamentos,
              categorias: initialState.categorias,
              marcas: initialState.marcas,
              presentaciones: initialState.presentaciones,
              proveedores: [],
              ultimoZ: 0,
              proximoRecibo: 1,
              proximaDevolucion: 1,
              proximaAnulacion: 1,
              acumuladoHistorico: 0,
              fechaUltimoZ: '',
              fondoCajaHoyUSD: 0,
              fondoCajaHoyBS: 0,
              isCashOpen: false,
              cashData: null,
              cashHistory: [],
              config: initialState.config,
              productCategories: initialState.productCategories,
              productUnits: initialState.productUnits,
              productColors: initialState.productColors,
              productSizes: initialState.productSizes,
              brands: [],
              groups: [],
              subgroups: [],
              lines: [],
              suppliers: [],
              marcasString: ['Genérica'],
              proveedoresString: [],
            });
            
            setSystemEmpty(false);
            setIsRegistering(false);
            toast({ 
              title: "¡Administrador Raíz Creado!", 
              description: "El sistema está listo. Por favor, inicie sesión.",
              variant: "default"
            });
            await signOut(auth);
        } else {
            toast({ title: "Usuario Creado", description: `El usuario ${user.email} fue creado.` });
        }

      } else {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
        const userDoc = await getDoc(doc(db, 'users', user.uid));

        if (!userDoc.exists()) {
            throw new Error("No hay registro de este usuario en la base de datos.");
        }

        const userData = userDoc.data();
        if (userData.rol !== role) {
             throw new Error(`Rol incorrecto. Usted es ${userData.rol.toUpperCase()}.`);
        }

        router.push('/');
      }

    } catch (err: any) {
      console.error('Error de Auth:', err);
      let mensaje = err.message || "Credenciales inválidas o fallo de conexión.";
      if (err.code === 'auth/email-already-in-use') mensaje = "El correo ya está registrado.";
      if (err.code === 'auth/weak-password') mensaje = "La contraseña es muy débil (mínimo 6 caracteres).";
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') mensaje = "Correo o contraseña incorrectos.";
      
      toast({ variant: "destructive", title: "Error de Acceso", description: mensaje });
      signOut(auth).catch(() => {});

    } finally {
      setLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-brand-gold border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink/40">Iniciando Módulos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#D4C5A6] via-[#C8B99A] to-[#B8A98A] flex items-center justify-center p-6">
      <div className="w-full max-w-[440px] bg-white rounded-[32px] shadow-[0_20px_50px_rgba(0,0,0,0.25)] p-10 animate-in fade-in zoom-in duration-500">
        
        <div className="mb-10 flex flex-col items-center">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 bg-[#C8952E] rounded-xl flex items-center justify-center text-black font-black text-2xl shadow-lg">P</div>
            <div className="font-display font-black text-2xl text-black tracking-tighter">Pos<span className="text-[#C8952E]">VEN</span> Pro</div>
          </div>
          <div className="h-1 w-12 bg-[#C8952E] rounded-full"></div>
        </div>

        <div className="mb-8 text-center">
          <h1 className="text-[28px] font-extrabold text-black leading-tight mb-2 tracking-tight">
            {isRegistering ? (systemEmpty ? 'Configurar Administrador Raíz' : 'Crear Nuevo Usuario') : '¡Bienvenido!'}
          </h1>
          <p className="text-[#9CA3AF] text-[14px] font-medium">
            {isRegistering ? (systemEmpty ? 'Este será el primer usuario con control total.' : 'Cree una nueva cuenta de acceso.') : 'Ingrese sus credenciales de acceso.'}
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Perfil de Usuario</label>
            <select 
              className="form-select h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-4 pr-10 text-black font-semibold focus:border-[#C8952E] outline-none transition-all cursor-pointer w-full disabled:bg-gray-200 disabled:cursor-not-allowed"
              value={role}
              onChange={e => setRole(e.target.value)} 
              required
              disabled={systemEmpty && isRegistering}
            >
              <option value="" disabled>Seleccione Rol</option>
              <option value="administrador">Administrador</option>
              <option value="cajero">Cajero / Operador</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Correo Electrónico</label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#C8952E] transition-colors">
                <Mail className="w-5 h-5" />
              </div>
              <input 
                type="email" 
                required 
                className="w-full h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-12 pr-4 text-black font-semibold placeholder:text-[#D1D5DB] focus:border-[#C8952E] focus:bg-white outline-none transition-all" 
                placeholder="ejemplo@correo.com" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-black/40 tracking-widest block ml-1">Contraseña</label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#C8952E] transition-colors">
                <Lock className="w-5 h-5" />
              </div>
              <input 
                type={showPassword ? "text" : "password"} 
                required 
                className="w-full h-[52px] bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl pl-12 pr-12 text-black font-semibold placeholder:text-[#D1D5DB] focus:border-[#C8952E] focus:bg-white outline-none transition-all" 
                placeholder="••••••••" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)} 
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[#C8952E]"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading} 
            className="w-full h-[56px] bg-[#C8952E] text-black font-black text-sm rounded-2xl flex items-center justify-center hover:bg-[#D9A540] transition-all disabled:opacity-50 shadow-lg uppercase tracking-widest"
          >
            {loading ? <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : (isRegistering ? (systemEmpty ? 'Crear Admin y Reiniciar' : 'Registrar Usuario') : 'Iniciar Sesión')}
          </button>
        </form>

        {systemEmpty && !isRegistering && (
            <div className="mt-6 text-center border-t-2 border-dashed border-red-300 pt-5">
                 <p className="text-[10px] font-bold text-red-500 uppercase  mx-auto">MODO EMERGENCIA: NO HAY USUARIOS</p>
                 <p className="text-xs text-gray-500 mt-1">Puede ingresar con cualquier credencial para configurar el sistema, o <button onClick={() => setIsRegistering(true)} className="font-bold text-[#C8952E] underline">crear el administrador raíz</button>.</p>
            </div>
        )}
      </div>
    </div>
  );
}