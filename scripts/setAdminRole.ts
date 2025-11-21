// scripts/setAdminRole.ts

import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// Inicializar la app de Firebase Admin usando variables de entorno
if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      '❌ Faltan variables de entorno: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

/**
 * Función principal para asignar roles de admin/superadmin usando Custom Claims
 * @param email - Email del usuario a quien asignar el rol
 * @param isSuperAdmin - Si es true, asigna superadmin; si es false, asigna admin normal
 */
export async function setAdminRole(email: string, isSuperAdmin: boolean): Promise<void> {
  try {
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new Error('Email inválido');
    }

    const user = await admin.auth().getUserByEmail(email);
    
    const customClaims = {
      admin: true,
      superadmin: isSuperAdmin,
    };

    await admin.auth().setCustomUserClaims(user.uid, customClaims);
    
    const roleText = isSuperAdmin ? 'superadmin' : 'admin';
    console.log(`✅ Usuario ${email} (UID: ${user.uid}) ahora tiene rol: ${roleText}`);
    console.log(`   Custom claims asignados:`, customClaims);
  } catch (error) {
    console.error('❌ Error al asignar el rol:', error);
    throw error;
  }
}

// CLI simple para ejecutar desde terminal
const args = process.argv.slice(2);

// Solo ejecuta el CLI si hay argumentos (significa que se ejecutó directamente)
if (args.length > 0) {
  let email: string | null = null;
  let isSuperAdmin = false;

  // Parsear argumentos
  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      email = arg.split('=')[1]?.replace(/^["']|["']$/g, '') || null;
    } else if (arg === '--superadmin') {
      isSuperAdmin = true;
    }
  }

  if (!email) {
    console.error('❌ Uso: ts-node scripts/setAdminRole.ts --email="correo@ejemplo.com" [--superadmin]');
    console.error('   --email: Email del usuario (requerido)');
    console.error('   --superadmin: Si se incluye, asigna rol superadmin; si no, asigna admin normal');
    process.exit(1);
  }

  setAdminRole(email, isSuperAdmin)
    .then(() => {
      console.log('✅ Proceso completado');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error fatal:', error);
      process.exit(1);
    });
}
