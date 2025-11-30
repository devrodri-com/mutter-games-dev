// src/utils/device.ts
// Helper para detectar dispositivos iOS de forma segura

/**
 * Detecta si el dispositivo actual es iOS (iPhone, iPad, iPod)
 * Protegido para SSR y tests
 * @returns true si es iOS, false en caso contrario
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent || navigator.platform || "";

  // Detectar iPhone, iPad, iPod
  return /iP(hone|od|ad)/.test(userAgent);
}

