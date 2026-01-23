export default async function handler(req: any, res: any) {
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const accessToken =
    process.env.MP_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN_DEV;

  if (!accessToken) {
    res.status(500).json({ error: "MP_ACCESS_TOKEN is not configured" });
    return;
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});

    const response = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      res.status(500).json({ error: data?.message || "MercadoPago error" });
      return;
    }

    res.status(200).json({ init_point: data?.init_point });
  } catch (error) {
    res.status(500).json({ error: "Failed to create preference" });
  }
}
