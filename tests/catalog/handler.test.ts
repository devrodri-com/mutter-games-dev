// @vitest-environment node
import { test, expect, vi, beforeAll, afterAll } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const deps=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock('firebase-admin/auth',()=>({getAuth:()=>({verifyIdToken:deps.verify})}));
import handler from '../../api/create-mp-preference';
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('Emulator required');
const app=initializeApp({projectId:'demo-mutter-handler'},'catalog-checkout');const db=getFirestore(app);
function response(){return {statusCode:0,body:undefined as unknown,setHeader(){},status(code:number){this.statusCode=code;return this;},json(body:unknown){this.body=body;return this;}};}
beforeAll(async()=>{await db.doc('operations/webStockCutover').set({schema:1,state:'open',revision:'synthetic-open-handler',updatedAt:new Date()});await db.collection('products').doc('p').set({active:true,title:'P',stockTotal:2,priceUSD:100});});
afterAll(async()=>{vi.unstubAllEnvs();await db.terminate();await deleteApp(app);});
test('missing and invalid bearer tokens create no intent or order',async()=>{
 for(const authorization of [undefined,'Basic invalid','Bearer bad']){
  deps.verify.mockRejectedValue(new Error('Invalid token'));const res=response();
  await handler({method:'POST',headers:{authorization},body:{}},res);expect(res.statusCode).toBe(401);
 }expect((await db.collection('orders').get()).size).toBe(0);expect((await db.collection('checkoutIntents').get()).size).toBe(0);
});
test('anonymous Firebase identity can quote through the real handler and catalog',async()=>{
 deps.verify.mockResolvedValue({uid:'verified-anonymous',firebase:{sign_in_provider:'anonymous'}});const res=response();
 await handler({method:'POST',headers:{authorization:'Bearer valid'},body:{action:'quote',purchase:{items:[{id:'p',quantity:1}],shipping:{pickup:true,department:'',name:'Test',address:'',city:'',postalCode:'',phone:'123',email:'test@example.invalid'}}}},res);
 expect(res.statusCode).toBe(200);expect(res.body).toMatchObject({quote:{total:100,currency:'UYU'}});
});

test('new admission rejects missing or duplicated platform IP before any order or preference',async()=>{
 vi.stubEnv('VERCEL','1');vi.stubEnv('MP_COLLECTOR_ID','200');
 vi.stubEnv('WEB_ADMISSION_HMAC_SECRET','synthetic-handler-admission-secret-at-least-32');
 vi.stubEnv('CRON_SECRET','different-synthetic-cron-secret');
 deps.verify.mockResolvedValue({uid:'verified-anonymous',firebase:{sign_in_provider:'anonymous'}});
 const purchase={items:[{id:'p',quantity:1}],shipping:{pickup:true,department:'',name:'Test',address:'',city:'',postalCode:'',phone:'123',email:'test@example.invalid'}};
 const quoted=response();
 await handler({method:'POST',headers:{authorization:'Bearer valid'},body:{action:'quote',purchase}},quoted);
 function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected synthetic response');return value as Record<string,unknown>;}
 const quoteHash=record(record(quoted.body).quote).hash;
 const body={action:'start',purchase,key:'synthetic-handler-intent-000000',quoteHash};
 const missing=response();
 await handler({method:'POST',headers:{authorization:'Bearer valid'},body},missing);
 expect(missing.statusCode).toBe(400);expect(missing.body).toMatchObject({code:'ADMISSION_IP_UNAVAILABLE'});
 const duplicated=response();
 await handler({method:'POST',headers:{authorization:'Bearer valid','x-vercel-forwarded-for':'192.0.2.9'},
  rawHeaders:['x-vercel-forwarded-for','192.0.2.9','X-Vercel-Forwarded-For','192.0.2.9'],body},duplicated);
 expect(duplicated.statusCode).toBe(400);expect(duplicated.body).toMatchObject({code:'ADMISSION_IP_UNAVAILABLE'});
 expect((await db.collection('orders').get()).empty).toBe(true);
 expect((await db.collection('checkoutIntents').get()).empty).toBe(true);
 expect((await db.collection('webAdmissionClaims').get()).empty).toBe(true);
});
