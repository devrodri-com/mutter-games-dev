// @vitest-environment node
import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { checkout } from '../../api/_lib/checkout-service';
import { parsePurchase, quotePurchase } from '../../api/_lib/checkout-domain';
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!host||!/^127\.0\.0\.1:\d+$/.test(host))throw new Error('Isolated emulator required');
const app=initializeApp({projectId:'demo-mutter-checkout'},'checkout-regression');const db=getFirestore(app);
const product={active:true,title:{es:'Juego',en:'Game'},priceUSD:200,stockTotal:5,variants:[{label:{es:'Color',en:'Color'},options:[{value:'Rojo',priceUSD:200,stock:5}]}]};
const purchase={items:[{id:'test-game',variantId:'Color-Rojo',quantity:1}],shipping:{pickup:false,department:'Montevideo',name:'Synthetic',address:'Test',city:'Test',postalCode:'10000',phone:'00000000',email:'synthetic@example.invalid'}};
let calls=0;const provider=async(id:string)=>{calls++;return {id:'pref-'+id,init_point:'https://www.mercadopago.com.uy/checkout/test'};};
let sequence=0;
async function start(input:unknown=purchase){const q=await checkout(db,'synthetic-user',{action:'quote',purchase:input},provider);if(!('quote' in q))throw Error('Expected quote');return {action:'start',purchase:input,key:`synthetic-intent-${++sequence}-000000`,quoteHash:q.quote.hash};}
beforeAll(async()=>{await fetch(`http://${host}/emulator/v1/projects/demo-mutter-checkout/databases/(default)/documents`,{method:'DELETE'});await db.collection('products').doc('test-game').set(product);});
afterAll(async()=>{await db.terminate();await deleteApp(app);});
test.each([false,undefined,null,'true',1])('strict publication rejects %s without writes',async active=>{
 const p={...product,active};const baseline=calls;const orders=(await db.collection('orders').get()).size;
 expect(()=>quotePurchase(parsePurchase(purchase),new Map([['test-game',p]]))).toThrow();
 expect(calls).toBe(baseline);expect((await db.collection('orders').get()).size).toBe(orders);
});
test.each([0,-1,0.5,100,Infinity])('quantity %s rejected',quantity=>{expect(()=>parsePurchase({...purchase,items:[{...purchase.items[0],quantity}]})).toThrow();});
test('prices, totals, userId and old snapshots cannot be submitted',async()=>{
 for(const input of [{...purchase,total:1},{...purchase,userId:'other'},{...purchase,items:[{...purchase.items[0],priceUSD:1}]}])await expect(checkout(db,'synthetic-user',{action:'quote',purchase:input},provider)).rejects.toThrow();
 await expect(checkout(db,'synthetic-user',{items:purchase.items,total:1},provider)).rejects.toThrow();
 await expect(checkout(db,'synthetic-user',{action:'start',purchase,orderId:'foreign'},provider)).rejects.toThrow();
});
test('variant missing, sold out, and duplicated quantities are rejected',()=>{
 const canonical=parsePurchase(purchase);
 expect(()=>quotePurchase({...canonical,items:[{...canonical.items[0],variantId:'wrong'}]},new Map([['test-game',product]]))).toThrow();
 expect(()=>quotePurchase(canonical,new Map([['test-game',{...product,variants:[{label:{es:'Color'},options:[{value:'Rojo',priceUSD:200,stock:0}]}]}]]))).toThrow();
 const duplicate={...purchase,items:[{...purchase.items[0],quantity:3},{...purchase.items[0],quantity:3}]};
 expect(()=>quotePurchase(parsePurchase(duplicate),new Map([['test-game',product]]))).toThrow();
 expect(()=>quotePurchase(canonical,new Map())).toThrow();
});
test('legacy product without variants requires explicit stockTotal',()=>{
 const p={...purchase,items:[{id:'legacy',quantity:2}]};
 expect(quotePurchase(parsePurchase(p),new Map([['legacy',{active:true,title:'Legacy',priceUSD:50,stockTotal:2}]]))).toMatchObject({total:269,currency:'UYU'});
 expect(()=>quotePurchase(parsePurchase(p),new Map([['legacy',{active:true,title:'Legacy',priceUSD:50}]]))).toThrow();
});
test('deactivation after quote creates neither order nor preference',async()=>{
 const input=await start();await db.collection('products').doc('test-game').update({active:false});const before=calls;const orders=(await db.collection('orders').get()).size;
 await expect(checkout(db,'synthetic-user',input,provider)).rejects.toThrow();expect(calls).toBe(before);expect((await db.collection('orders').get()).size).toBe(orders);
 await db.collection('products').doc('test-game').set(product);
});
test('canonical total, double click, retry, lost client response and conflicting key',async()=>{
 const input=await start();const before=calls;const results=await Promise.allSettled([checkout(db,'synthetic-user',input,provider),checkout(db,'synthetic-user',input,provider)]);
 expect(results.some(r=>r.status==='fulfilled')).toBe(true);expect(calls).toBe(before+1);
 const recovered=await checkout(db,'synthetic-user',input,provider);expect(calls).toBe(before+1);
 if(!('id' in recovered))throw Error('Missing order');
 const order=(await db.collection('orders').doc(recovered.id).get()).data();expect(order).toMatchObject({total:369,currency:'UYU',uid:'synthetic-user',paymentStatus:'pending'});
 expect(order?.items[0]).toMatchObject({title:{es:'Juego'},priceUSD:200,price:200,variantLabel:'Color-Rojo'});expect(order?.shipping).toMatchObject({state:'Montevideo',cost:169});
 await expect(checkout(db,'synthetic-user',{...input,purchase:{...purchase,items:[{...purchase.items[0],quantity:2}]}},provider)).rejects.toThrow('otro contenido');
});
test('uncertain provider response remains durably locked',async()=>{
 const input=await start();let invoked=0;const timeout=async()=>{invoked++;throw Error('Timeout after acceptance');};
 await expect(checkout(db,'synthetic-user',input,timeout)).rejects.toThrow('requiere verificación');
 await expect(checkout(db,'synthetic-user',input,timeout)).rejects.toThrow('verificación');expect(invoked).toBe(1);
});
test('deleted catalog product does not invoke provider or write an order',async()=>{
 const input=await start();await db.collection('products').doc('test-game').delete();const count=calls;const orders=(await db.collection('orders').get()).size;
 await expect(checkout(db,'synthetic-user',input,provider)).rejects.toThrow();expect(calls).toBe(count);expect((await db.collection('orders').get()).size).toBe(orders);
});

test('foreign intent owner is denied and a failed SDK catalog read creates nothing',async()=>{
 await db.collection('products').doc('test-game').set(product);
 const input=await start();
 const {hash}=await import('../../api/_lib/checkout-domain');
 const intent=db.collection('checkoutIntents').doc(hash(['synthetic-user',input.key]));
 await intent.set({uid:'other-user',state:'ready',requestHash:'foreign'});
 const count=calls;const orders=(await db.collection('orders').get()).size;
 await expect(checkout(db,'synthetic-user',input,provider)).rejects.toMatchObject({status:403});
 // Fault injection at the external Firestore SDK boundary, after real persistence checks above.
 const read=vi.spyOn(db,'getAll').mockRejectedValueOnce(new Error('Catalog transport unavailable'));
 try { await expect(checkout(db,'synthetic-user',{action:'quote',purchase},provider)).rejects.toThrow('Catalog transport unavailable'); }
 finally { read.mockRestore(); }
 expect(calls).toBe(count);expect((await db.collection('orders').get()).size).toBe(orders);
});
