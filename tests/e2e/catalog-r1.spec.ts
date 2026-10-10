import { test, expect, type APIRequestContext } from '@playwright/test';
import { initializeDemoAdmin } from '../catalog/demo-admin';
import { getFirestore } from 'firebase-admin/firestore';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188')throw Error('Local demo emulator required');
const db=getFirestore(initializeDemoAdmin('browser-fixtures'));
const product={active:true,title:{es:'Juego sintético R1',en:'Synthetic game R1'},priceUSD:100,stockTotal:5,slug:'r1-synthetic',description:'Prueba local',category:{id:'r1-games',name:'Games'},subcategory:{id:'r1-sub',name:'Sub',categoryId:'r1-games'},variants:[],images:[]};
const item={id:'r1-ui-product',slug:'r1-synthetic',name:'Snapshot antiguo',title:product.title,priceUSD:50,price:50,quantity:1,image:''};
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 await db.collection('products').doc(item.id).set(product);
});
test('direct detail, withdrawn product and navigation',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/producto/r1-synthetic');await expect(page.getByRole('heading',{name:'Juego sintético R1'})).toBeVisible();
 await db.collection('products').doc(item.id).update({active:false});
 await expect(page.getByText('Producto no disponible',{exact:true})).toBeVisible();await page.getByRole('link',{name:'Volver a la tienda'}).click();await expect(page).toHaveURL(/shop/);expect(errors).toEqual([]);
});
test('restored cart updates price, explicit last-item clear survives reload and remote readback',async({page})=>{
 await page.addInitScript(value=>{if(!localStorage.getItem('seeded')){localStorage.setItem('cartItems',JSON.stringify([value]));localStorage.setItem('seeded','yes');}},item);
 await page.goto('/carrito');await expect(page.getByText('El precio cambió. Revisá el importe actualizado.')).toBeVisible();await expect(page.getByText('$100.00 c/u',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Quitar',exact:true}).click();await expect(page.getByText('Juego sintético R1',{exact:true})).toHaveCount(0);
 await expect.poll(async()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('mutter-cart:')).map(k=>JSON.parse(localStorage.getItem(k)||'{}').dirty))).toEqual([false]);
 const uid=await page.evaluate(()=>Object.keys(localStorage).find(k=>k.startsWith('mutter-cart:'))?.slice('mutter-cart:'.length));expect(uid).toBeTruthy();
 if(!uid)throw Error('UID missing');expect((await db.collection('carts').doc(uid).get()).data()?.cartItems).toEqual([]);
 await page.reload();await expect(page.getByText('Juego sintético R1',{exact:true})).toHaveCount(0);
});
test('withdrawn snapshot retained with warning and excluded from checkout',async({page})=>{
 await db.collection('products').doc(item.id).update({active:false});
 await page.addInitScript(value=>localStorage.setItem('cartItems',JSON.stringify([value])),item);
 await page.goto('/carrito');await expect(page.getByText('No disponible para compra',{exact:true})).toBeVisible();await expect(page.getByText('Juego sintético R1',{exact:true})).toBeVisible();
});

test('same identity on another device observes explicit clear',async({page,browser})=>{
 await page.addInitScript(value=>{if(!localStorage.getItem('seeded')){localStorage.setItem('cartItems',JSON.stringify([value]));localStorage.setItem('seeded','yes');}},item);
 await page.goto('/carrito');await expect(page.getByText('$100.00 c/u',{exact:true})).toBeVisible();
 const state=await page.context().storageState({indexedDB:true});
 const device=await browser.newContext({storageState:state});
 try{const other=await device.newPage();await other.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await other.goto('http://127.0.0.1:5277/carrito');await expect(other.getByText('$100.00 c/u',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Quitar',exact:true}).click();await expect(other.getByText('Juego sintético R1',{exact:true})).toHaveCount(0);
 }finally{await device.close();}
});


async function syntheticBuyer(request: APIRequestContext): Promise<{ Authorization: string }> {
 const authResponse = await request.post('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signUp?key=synthetic', { data: { returnSecureToken: true } });
 expect(authResponse.ok()).toBe(true);
 const identity: unknown = await authResponse.json();
 if (!identity || typeof identity !== 'object' || !('idToken' in identity) || typeof identity.idToken !== 'string') throw new Error('Synthetic auth token missing');
 const admitted = await request.post('/api/access/session', { headers: { Authorization: `Bearer ${identity.idToken}` }, data: {} });
 expect(admitted.status()).toBe(200);
 const session: unknown = await admitted.json();
 if (!session || typeof session !== 'object' || !('customToken' in session) || typeof session.customToken !== 'string') throw Error('Real session admission missing');
 const custom = await request.post('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic', { data: { token: session.customToken, returnSecureToken: true } });
 expect(custom.status()).toBe(200);
 const signed: unknown = await custom.json();
 if (!signed || typeof signed !== 'object' || !('idToken' in signed) || typeof signed.idToken !== 'string') throw Error('Real admitted token missing');
 return { Authorization: `Bearer ${signed.idToken}` };
}

test('real checkout reserves the last unit and the open product stops offering it', async ({ page, request }, testInfo) => {
 await db.collection('products').doc(item.id).set({ ...product, stockTotal: 1 });
 let releaseAdmission: (() => void) | undefined;
 const admissionGate = new Promise<void>(resolve => { releaseAdmission = resolve; });
 let firstAdmission = true;
 await page.route('http://127.0.0.1:5277/api/access/session', async route => {
  if (firstAdmission && route.request().method() === 'POST') {
   firstAdmission = false; await admissionGate;
  }
  await route.continue(); // Keep the official Auth process and real admission response.
 });
 const admissionRequested = page.waitForRequest(req => req.url() === 'http://127.0.0.1:5277/api/access/session' && req.method() === 'POST');
 try {
  await page.goto('/producto/r1-synthetic'); await admissionRequested;
  await expect(page.getByRole('button', { name: 'Agregar al carrito', exact: true })).toBeDisabled();
  const quickBuy = page.getByRole('button', { name: 'Comprar ahora', exact: true, includeHidden: true });
  // The responsive sticky control is absent while the main buy block is in view.
  if (await quickBuy.count()) await expect(quickBuy).toBeDisabled();
  await expect(page.getByText('Comprobando el acceso a tu carrito…', { exact: true })).toBeVisible();
 } finally { if (releaseAdmission) releaseAdmission(); }
 await expect(page.getByRole('button', { name: 'Agregar al carrito', exact: true })).toBeEnabled();
 await page.getByRole('button', { name: 'Agregar al carrito', exact: true }).click();
 await expect(page.getByText('Agregado al carrito', { exact: true })).toBeVisible();
 await expect.poll(() => page.evaluate(id => {
  const keys = Object.keys(localStorage).filter(key => key.startsWith('mutter-cart:'));
  if (keys.length !== 1) return false;
  const cached: unknown = JSON.parse(localStorage.getItem(keys[0]) || 'null');
  if (!cached || typeof cached !== 'object' || !('dirty' in cached) || cached.dirty !== false || !('items' in cached) || !Array.isArray(cached.items)) return false;
  return cached.items.some((entry: unknown) => Boolean(entry && typeof entry === 'object' && 'id' in entry && entry.id === id && 'quantity' in entry && entry.quantity === 1));
 }, item.id)).toBe(true);
 const cartUid = await page.evaluate(() => Object.keys(localStorage).find(key => key.startsWith('mutter-cart:'))?.slice('mutter-cart:'.length));
 if (!cartUid) throw new Error('Confirmed cart UID missing');
 await expect.poll(async () => {
  const saved: unknown = (await db.collection('carts').doc(cartUid).get()).data()?.cartItems;
  return Array.isArray(saved) && saved.some((entry: unknown) => Boolean(entry && typeof entry === 'object' && 'id' in entry && entry.id === item.id && 'quantity' in entry && entry.quantity === 1));
 }).toBe(true);
 const cartPage = await page.context().newPage();
 await cartPage.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
 await cartPage.goto('/carrito');
 await expect(cartPage.getByText('$100.00 c/u', { exact: true })).toBeVisible();
 expect(await cartPage.evaluate(() => Object.keys(localStorage).find(key => key.startsWith('mutter-cart:'))?.slice('mutter-cart:'.length))).toBe(cartUid);
 await expect(cartPage.getByText('No disponible para compra', { exact: true })).toHaveCount(0);
 const headers = await syntheticBuyer(request);
 const purchase = { items: [{ id: item.id, quantity: 1 }], shipping: { pickup: true, department: '', name: 'Synthetic Buyer', address: '', city: '', postalCode: '', phone: '00000000', email: 'browser@example.invalid' } };
 const quoted = await request.post('/api/create-mp-preference', { headers, data: { action: 'quote', purchase } });
 expect(quoted.status()).toBe(200);
 const quoteResult: unknown = await quoted.json();
 if (!quoteResult || typeof quoteResult !== 'object' || !('quote' in quoteResult) || !quoteResult.quote || typeof quoteResult.quote !== 'object' || !('hash' in quoteResult.quote) || typeof quoteResult.quote.hash !== 'string') throw new Error('Real quote missing');
 const started = await request.post('/api/create-mp-preference', { headers, data: { action: 'start', purchase, quoteHash: quoteResult.quote.hash, key: crypto.randomUUID() } });
 expect(started.status()).toBe(200);
 const startResult: unknown = await started.json();
 expect(startResult).toMatchObject({ init_point: expect.stringContaining('synthetic-browser-') });
 await expect(page.getByRole('button', { name: 'SIN STOCK', exact: true })).toBeDisabled();
 await expect(cartPage.getByText('No disponible para compra', { exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: 'Comprar ahora', exact: true })).toHaveCount(0);
 const stored = (await db.collection('products').doc(item.id).get()).data();
 expect(stored?.stockTotal).toBe(1); expect(Object.keys(stored?.webReservations ?? {})).toHaveLength(1);
 const competingBuyer = await syntheticBuyer(request);
 const blocked = await request.post('/api/create-mp-preference', { headers: competingBuyer, data: { action: 'start', purchase, quoteHash: quoteResult.quote.hash, key: crypto.randomUUID() } });
 expect(blocked.status()).toBe(409); expect(await blocked.json()).not.toHaveProperty('init_point');
 await page.screenshot({ path: testInfo.outputPath('last-unit-reserved.png'), fullPage: true });
 await cartPage.screenshot({ path: testInfo.outputPath('cart-unit-reserved.png'), fullPage: true });
 await cartPage.close();
});
