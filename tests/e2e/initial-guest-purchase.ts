import { expect, type Page } from '@playwright/test';

export const initialGuestCopy = 'Podés comprar sin registrarte. Esta compra empezará con un carrito vacío y no recupera ni traslada compras anteriores. Si tenés una cuenta, podés ingresar.';
export const initialGuestAction = (page: Page) => page.getByRole('button', { name: 'Empezar compra como invitado', exact: true });

/** The real UI decision remains part of setup, before any guest SDK creation. */
export async function chooseInitialGuestPurchase(page: Page) {
  await expect(page.getByText(initialGuestCopy, { exact: true })).toBeVisible();
  await initialGuestAction(page).click();
}

async function admittedGuestUid(page: Page): Promise<string | null> {
  const observed: unknown = await page.evaluate(async path => (await import(path)).identity(), '/tests/e2e/legacy-guest-client.ts');
  if (!observed || typeof observed !== 'object' || !('uid' in observed) || typeof observed.uid !== 'string'
    || !('sessionId' in observed) || typeof observed.sessionId !== 'string' || !('provider' in observed) || observed.provider !== 'custom'
    || !('admin' in observed) || observed.admin !== false || !('superadmin' in observed) || observed.superadmin !== false) return null;
  return observed.uid;
}

export async function beginInitialGuestPurchase(page: Page): Promise<string> {
  await chooseInitialGuestPurchase(page);
  await expect.poll(() => admittedGuestUid(page)).not.toBeNull();
  const uid = await admittedGuestUid(page);
  if (!uid) throw Error('Expected actual UI-created admitted guest');
  return uid;
}
