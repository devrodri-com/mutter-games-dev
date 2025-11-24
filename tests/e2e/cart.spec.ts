import { test, expect } from "@playwright/test";

test.skip("visitante puede agregar un producto al carrito y verlo en /cart (pendiente ajustar flujo UI)", async ({ page }) => {
  await page.goto("/shop");

  // Header visible
  await expect(page.getByRole("banner")).toBeVisible();

  // Hace click en el primer producto visible
  const firstProduct = page.locator("a[href^='/product']").first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.click();

  // En la página de producto: verificar que hay un título visible (h1)
  await expect(page.locator("h1")).toBeVisible();

  // Hacer click en el botón para agregar al carrito
  const addToCartButton = page.getByRole("button", { name: /Agregar al carrito|Add to cart/i });
  await expect(addToCartButton).toBeVisible();
  await addToCartButton.click();

  // Ir a la página de carrito
  await page.goto("/cart");

  // Esperar a que aparezca un ítem del carrito
  const cartItem = page.locator("[data-testid='cart-item']").first();
  await expect(cartItem).toBeVisible({ timeout: 15000 });
});
