// src/utils/handleImageUpload.ts

import { auth } from "../firebase";

export const uploadImageToImageKit = async (file: File): Promise<string | null> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileName", file.name);
  formData.append("folder", "/"); // raíz del espacio muttergames
  formData.append("useUniqueFileName", "true");

  try {
    // 1. Obtener token del admin actual
    const current = auth.currentUser;
    if (!current) {
      console.error("No hay usuario autenticado para firmar imagen");
      if (import.meta.env.DEV) {
        console.warn("⚠️ DEV: usando imagen placeholder porque no hay auth");
        return "https://picsum.photos/600";
      }
      return null;
    }

    const idToken = await current.getIdToken();

    // 2. Obtener firma desde el backend admin, enviando Authorization
    const signatureRes = await fetch(
      `${import.meta.env.VITE_ADMIN_API_URL}/api/imagekit-signature`,
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      }
    );
    const signatureData = await signatureRes.json();

    if (!signatureRes.ok) {
      console.error("Error obteniendo firma:", signatureData);
      if (import.meta.env.DEV) {
        console.warn("⚠️ DEV: usando imagen placeholder porque falló la subida a ImageKit");
        return "https://picsum.photos/600";
      }
      return null;
    }

    const { signature, expire, token, publicKey } = signatureData;

    // 2. Adjuntar datos de autenticación
    formData.append("signature", signature);
    formData.append("expire", expire.toString());
    formData.append("token", token);
    formData.append("publicKey", publicKey);

    // 3. Enviar a ImageKit
    const uploadRes = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      body: formData,
    });

    const data = await uploadRes.json();

    if (uploadRes.ok && data?.url) {
      return data.url;
    }

    console.error("Error al subir imagen a ImageKit:", data);
    if (import.meta.env.DEV) {
      console.warn("⚠️ DEV: usando imagen placeholder porque falló la subida a ImageKit");
      return "https://picsum.photos/600";
    }
    return null;
  } catch (error) {
    console.error("Error de red al subir imagen:", error);
    if (import.meta.env.DEV) {
      console.warn("⚠️ DEV: usando imagen placeholder porque falló la subida a ImageKit");
      return "https://picsum.photos/600";
    }
    return null;
  }
};

export const handleImageUpload = uploadImageToImageKit;