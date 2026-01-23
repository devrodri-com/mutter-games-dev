export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const baseUrl =
    process.env.VITE_ADMIN_API_URL ||
    "https://mutter-games-admin-api-prod.vercel.app";
  const url = `${baseUrl}/api/create-mp-preference`;

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});

    const authHeader =
      typeof req.headers?.authorization === "string"
        ? req.headers.authorization
        : undefined;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to create preference" });
  }
}
