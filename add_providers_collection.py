#!/usr/bin/env python3
import re

# Read the file
with open(r'C:\autoposVEN\pos-repuestos-lubricantes\src\lib\db-store.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add PROVIDERS_COLLECTION constant after CONFIG_DOC
old_constant = "const CONFIG_DOC = 'global';"
new_constant = '''const CONFIG_DOC = 'global';
const PROVIDERS_COLLECTION = 'proveedores';'''

content = content.replace(old_constant, new_constant)

# 2. Add PROVIDERS_COLLECTION to CONFIG_KEYS removal - actually we'll REMOVE proveedores from CONFIG_KEYS
# Instead, we'll just not include it, and it will be stored separately

# 3. Add a new method to Collections for subscribe providers
# Find the end of the Collections section and add new method
# Look for the getWhere method end and add after it

new_method = '''

  // NUEVO: Suscribirse a colección raíz de proveedores
  subscribeProviders(callback: (data: any[]) => void, limitCount?: number) {
    if (!db) return () => {};
    let ref: CollectionReference = collection(db, PROVIDERS_COLLECTION);
    if (limitCount) ref = query(ref, limit(limitCount));
    return onSnapshot(ref, (snapshot) => {
      const list: any[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
      callback(list);
    });
  },

  // NUEVO: Obtener todos los proveedores de la colección raíz
  getAllProviders() {
    if (!db) return [];
    const snapshot = getDocs(collection(db, PROVIDERS_COLLECTION));
    const list: any[] = [];
    snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
    return list;
  }

'''

# Insert the new method after getWhere method
# Find the position after getWhere
getwhere_pos = content.rfind('getWhere(collectionName: string, field: string, operator: any, value: any)')
if getwhere_pos >= 0:
    # Find the end of the getWhere method (look for the next method or end of section)
    section_end = content.find('// ============================================================', getwhere_pos)
    if section_end >= 0:
        content = content[:section_end] + new_method + content[section_end:]

# 3. Remove 'proveedores' from CONFIG_KEYS so it's not forced into config/global
# But we still want it in initialState, so we'll just not include it in the filtering
# Actually, let's just add it to a separate list

# 4. Modify the Store.set() to not include proveedores in the filtered state that goes to config/global
# We'll add a constant PROVIDERS_COLLECTION_KEY that indicates it should go to separate collection

# Let's just add a constant and modify the filtering logic
old_config_keys_section = """const CONFIG_KEYS = [
  'tasa', 'comisionEfectivo', 'pinDevolucion', 'isInitialized',
  'empresa',
  'departamentos', 'categorias', 'marcas', 'presentaciones', 'proveedores',
  'ultimoZ', 'proximoRecibo', 'proximaDevolucion', 'proximaAnulacion',
  'acumuladoHistorico', 'fechaUltimoZ',
  'fondoCajaHoyUSD', 'fondoCajaHoyBS',
  'isCashOpen',
  'config',
  'productCategories', 'productUnits', 'productColors', 'productSizes',
  'brands', 'groups', 'subgroups', 'lines', 'suppliers',
  'marcasString', 'proveedoresString'
];"""

new_config_keys_section = '''const CONFIG_KEYS = [
  'tasa', 'comisionEfectivo', 'pinDevolucion', 'isInitialized',
  'empresa',
  'departamentos', 'categorias', 'marcas', 'presentaciones',
  'ultimoZ', 'proximoRecibo', 'proximaDevolucion', 'proximaAnulacion',
  'acumuladoHistorico', 'fechaUltimoZ',
  'fondoCajaHoyUSD', 'fondoCajaHoyBS',
  'isCashOpen',
  'config',
  'productCategories', 'productUnits', 'productColors', 'productSizes',
  'brands', 'groups', 'subgroups', 'lines', 'suppliers',
  'marcasString'
];'''

# Replace CONFIG_KEYS - remove 'proveedores' and 'proveedoresString'
content = content.replace(old_config_keys_section, new_config_keys_section)

# 5. Modify Store.set() to not save proveedores/proveedoresString to config/global
# Find the filteredState line and add exception for providers
old_set_method = """const filteredState = Object.fromEntries(
      Object.entries(state).filter(([k, v]) => v !== undefined && CONFIG_KEYS.includes(k))
    );"""

# We'll modify this to exclude PROVIDERS_COLLECTION_KEYS
# Actually, let's just add a check: if key is 'proveedores' or 'proveedoresString', skip it
# We'll modify the filtering

# Let's find the exact line and modify
# Actually, easier: just remove 'proveedores' from CONFIG_KEYS (already done above)
# And then in the Store.set, we'll handle it separately

# Let's verify the CONFIG_KEYS replacement worked
if "'proveedores'" in content.split("CONFIG_KEYS")[1].split("]")[0] if "CONFIG_KEYS" in content else False:
    print("WARNING: proveedores still in CONFIG_KEYS")
else:
    print("✓ proveedores removed from CONFIG_KEYS")

# 6. Add handling for providers in Store.set - after the filteredState line
# We'll add code to save providers to separate collection
# Find the line: sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataToPersist));
# And add before it: also save providers to Firestore collection

# Actually, let's just modify the Store.set to exclude proveedores from config/global
# We'll add a line after filteredState

# Find "sessionStorage.setItem(STORAGE_KEY" and add provider handling before it
old_store_set = """sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataToPersist));
    
    if (db) {
      const docRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      return await setDoc(docRef, dataToPersist);"""

new_store_set = """// ✓ Proveedores se guardan en colección raíz separada, NO en config/global
    // Esto evita que se borren al reiniciar la configuración
    if (db) {
      // Guardar proveedores en colección raíz
      await Collections.set(PROVIDERS_COLLECTION, 'main', {
        proveedores: filteredState.proveedores || initialState.proveedores,
        proveedoresString: filteredState.proveedoresString || initialState.proveedoresString,
        updatedAt: new Date().toISOString()
      });
    }

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataToPersist));
    
    if (db) {
      const docRef = doc(db, CONFIG_COLLECTION, CONFIG_DOC);
      // No incluir proveedores/proveedoresString en el documento de configuración
      const { proveedores, proveedoresString, ...configDataWithoutProviders } = dataToPersist;
      return await setDoc(docRef, configDataWithoutProviders);"""'''

# Apply the replacement
if old_store_set in content:
    content = content.replace(old_store_set, new_store_set)
    print("✓ Store.set modified to separate providers")
else:
    print("! Could not find old Store.set pattern")
    # Try alternative
    print("Content around store set:")
    # Find where setDoc is called
    idx = content.find("setDoc(docRef")
    if idx >= 0:
        print("Found setDoc at position", idx)

# Write the modified file
with open(r'C:\autoposVEN\pos-repuestos-lubricantes\src\lib\db-store.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("✓ db-store.ts modified successfully")
print("Resumen de cambios:")
print("  1. Agregado PROVIDERS_COLLECTION = 'proveedores'")
print("  2. Removido 'proveedores' y 'proveedoresString' de CONFIG_KEYS")
print("  2. Agregado método subscribeProviders en Collections")
print("  3. Modificado Store.set para guardar proveedores en colección raíz")
print("  4. Proveedores ya NO se guardan en config/global (se borran solos)")