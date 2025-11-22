// src/utils/userUtils.ts
// Stub legacy. Solo para que el código compile. NO se usa para seguridad real.

export type LegacyUser = {
    email: string;
    password?: string;
    name?: string;
    role?: string;
  };
  
  export function getLoggedInUser(): LegacyUser | null {
    // La auth real usa Firebase Auth + claims.
    return null;
  }
  
  export function loginUser(_email: string, _password: string): LegacyUser | null {
    console.warn("[legacy] loginUser llamado; usá Firebase Auth en vez de userUtils.");
    return null;
  }
  
  export function logoutUser(): void {
    console.warn("[legacy] logoutUser llamado; usá Firebase Auth en vez de userUtils.");
  }
  
  export function getUsers(): LegacyUser[] {
    console.warn("[legacy] getUsers llamado; lista de usuarios legacy vacía.");
    return [];
  }
  
  export function updateUser(_user: LegacyUser): void {
    console.warn("[legacy] updateUser llamado; sin efecto (legacy).");
  }