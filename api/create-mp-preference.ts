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

    const rawItems = body.items ?? body.cartItems ?? [];
    const mpItems = rawItems
      .map((item: any) => {
        const title =
          item.title?.es ||
          item.title ||
          item.name ||
          item.slug;
        const quantity = Math.max(1, Number(item.quantity || 1));
        const unit_price = Number(item.priceUYU ?? item.priceUSD ?? item.price ?? item.unit_price);
        if (!title || isNaN(unit_price)) return null;
        return { title, quantity, unit_price };
      })
      .filter((item: any) => item !== null);

    if (mpItems.length === 0) {
      res.status(400).json({ error: "unit_price needed" });
      return;
    }

    const mpPayload = {
      items: mpItems,
      ...(body.back_urls ? { back_urls: body.back_urls } : {}),
      ...(body.auto_return ? { auto_return: body.auto_return } : {}),
      ...(body.notification_url ? { notification_url: body.notification_url } : {}),
      ...(body.external_reference ? { external_reference: body.external_reference } : {}),
    };

    const response = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(mpPayload),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      res.status(400).json({ error: data?.message || data?.error || "MercadoPago error", details: data });
      return;
    }

    res.status(200).json({ init_point: data?.init_point });
  } catch (error) {
    res.status(500).json({ error: "Failed to create preference" });
  }
}
