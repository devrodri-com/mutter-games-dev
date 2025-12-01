// src/utils/imagekitUtils.ts
import { adminApiFetch } from "./adminApi";

export async function uploadImageToImageKit(file: File): Promise<string | null> {
  try {
    // 1) Obtener firma y credenciales desde la Admin API
    const authParams = await adminApiFetch("/api/imagekit-signature", {
      method: "GET",
    });

    // 2) Subir el archivo directamente a ImageKit usando los parámetros recibidos
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("publicKey", authParams.publicKey);
    formData.append("signature", authParams.signature);
    formData.append("expire", authParams.expire.toString());
    formData.append("token", authParams.token);
    formData.append("useUniqueFileName", "true");

    const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Error al subir imagen a ImageKit: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.url) {
      throw new Error("La respuesta de ImageKit no contiene URL");
    }

    return data.url;
  } catch (error) {
    console.error("Error uploading to ImageKit", error);
    return null;
  }
}