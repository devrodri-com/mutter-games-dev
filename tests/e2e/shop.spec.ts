import { test, expect } from "@playwright/test";

test("visitante puede ver el home y abrir un producto", async ({ page }) => {
  await page.goto("/shop");

  // Header visible
  await expect(page.getByRole("banner")).toBeVisible();

  // Verificamos un texto que SIEMPRE existe en el home real
  await expect(page.getByRole("heading", { name: /Productos disponibles/i })).toBeVisible();

  // Hace click en el primer producto encontrado
  const firstProduct = page.locator("a[href^='/product']").first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.click();

  // Página de producto cargó
  await expect(page.locator("h1")).toBeVisible();
});