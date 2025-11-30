// src/utils/safeStorage.ts
// Wrapper seguro para localStorage con fallback a Map en memoria

// Fallback en memoria si localStorage no está disponible o falla
const memoryStorage = new Map<string, string>();

/**
 * Verifica si localStorage está disponible y funciona
 */
function isLocalStorageAvailable(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const testKey = "__safeStorage_test__";
    window.localStorage.setItem(testKey, "test");
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const useMemoryStorage = !isLocalStorageAvailable();

/**
 * Obtiene un valor de localStorage (o fallback en memoria)
 * @param key - Clave del item
 * @returns Valor como string o null si no existe
 */
export function getItem(key: string): string | null {
  try {
    if (useMemoryStorage) {
      return memoryStorage.get(key) || null;
    }
    return window.localStorage.getItem(key);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[safeStorage] Error al leer ${key}, usando fallback en memoria:`, error);
    }
    return memoryStorage.get(key) || null;
  }
}

/**
 * Guarda un valor en localStorage (o fallback en memoria)
 * @param key - Clave del item
 * @param value - Valor a guardar (se convierte a string)
 */
export function setItem(key: string, value: string): void {
  try {
    if (useMemoryStorage) {
      memoryStorage.set(key, value);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[safeStorage] Error al escribir ${key}, usando fallback en memoria:`, error);
    }
    memoryStorage.set(key, value);
  }
}

/**
 * Elimina un item de localStorage (o fallback en memoria)
 * @param key - Clave del item a eliminar
 */
export function removeItem(key: string): void {
  try {
    if (useMemoryStorage) {
      memoryStorage.delete(key);
      return;
    }
    window.localStorage.removeItem(key);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[safeStorage] Error al eliminar ${key}, usando fallback en memoria:`, error);
    }
    memoryStorage.delete(key);
  }
}

/**
 * Parsea de forma segura un JSON desde localStorage
 * Si el JSON está corrupto, limpia el item y devuelve el fallback
 * @param key - Clave del item
 * @param fallback - Valor por defecto si no existe o está corrupto
 * @returns Valor parseado o fallback
 */
export function safeParse<T>(key: string, fallback: T): T {
  try {
    const raw = getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    // Si los datos están corruptos, los limpiamos y devolvemos el fallback
    if (import.meta.env.DEV) {
      console.warn(`[safeStorage] JSON corrupto en ${key}, limpiando y usando fallback:`, error);
    }
    try {
      removeItem(key);
    } catch {
      // ignorar errores al limpiar
    }
    return fallback;
  }
}

