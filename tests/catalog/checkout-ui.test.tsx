import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {test,expect,vi,beforeEach,afterEach} from 'vitest';
const sdk=vi.hoisted(()=>({listeners:[] as ((value:unknown)=>void)[],user:{uid:'ui-checkout',getIdToken:async()=>'synthetic'}}));
const admission=vi.hoisted(()=>({ensure:vi.fn()}));
// This stock/checkout suite supplies an admitted session at the Auth boundary.
// Real Auth/SDK/Rules and access UI suites cover capability authorization.
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ credentialAccess: 'active' }) }));
vi.mock('../../src/firebase',()=>({auth:{get currentUser(){return sdk.user;}},db:{}}));
// This client suite controls admission at its declared boundary. The full
// browser flow uses the real SDK, session exchange and server authorization.
vi.mock('../../src/utils/credentialAccess',()=>({ensureCredentialSession:admission.ensure}));
vi.mock('../../src/firebaseUtils',()=>({db:{},upsertClientFromCheckout:vi.fn()}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,fn:(user:unknown)=>void)=>{fn(sdk.user);return ()=>undefined;}}));
vi.mock('react-hot-toast',()=>({toast:{error:vi.fn()}}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,collection:string,id:string)=>({collection,id}),collection:vi.fn(),query:vi.fn(),where:vi.fn(),limit:vi.fn(),startAfter:vi.fn(),getDocsFromServer:vi.fn(),getDocFromServer:async()=>({exists:()=>true,id:'p',data:()=>({active:true,title:'P',priceUSD:100,stockTotal:2})}),setDoc:async()=>undefined,serverTimestamp:()=>0,onSnapshot:(ref:{collection:string},_options:unknown,fn:(value:unknown)=>void)=>{if(ref.collection==='carts')sdk.listeners.push(fn);return ()=>undefined;},addDoc:vi.fn(),updateDoc:vi.fn(),deleteDoc:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
import {CartProvider,useCart} from '../../src/context/CartContext';
import {useCatalogCheckout} from '../../src/hooks/useCatalogCheckout';
import {startCheckout} from '../../src/utils/createPreference';
let cart:ReturnType<typeof useCart>;let checkout:ReturnType<typeof useCatalogCheckout>;let root:ReturnType<typeof createRoot>|undefined;
function Probe(){cart=useCart();checkout=useCatalogCheckout(true);return <div/>;}
const active=(uid:string)=>({status:'ACTIVE' as const,uid,scope:'BUYER_POST_CUTOVER_V1' as const,admin:false,superadmin:false,expiresAtMs:Date.now()+60_000});
beforeEach(()=>{sdk.user={uid:'ui-checkout',getIdToken:async()=>'synthetic'};sdk.listeners=[];admission.ensure.mockReset().mockImplementation(async(user:{uid:string})=>active(user.uid));});
afterEach(async()=>{await act(async()=>root?.unmount());root=undefined;document.body.innerHTML='';vi.unstubAllGlobals();localStorage.clear();});
test('real cart + checkout hook reviews server amount before start and keeps one key after lost response',async()=>{
 localStorage.clear();sdk.listeners=[];const requests:Record<string,unknown>[]=[];let hash='a'.repeat(64);
 // HTTP is the external boundary. Server calculations and provider behavior have separate real-handler tests.
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
  const body=JSON.parse(String(options.body));requests.push(body);
  if(body.action==='availability')return new Response(JSON.stringify({checked:true}));
  if(body.action==='quote')return new Response(JSON.stringify({quote:{total:100,currency:'UYU',shippingCost:0,hash,items:[{id:'p',title:'P',variantId:'',quantity:1,unitPrice:100,stock:2}]}}));
  throw new Error('HTTP response lost');
 }));
 const element=document.createElement('div');document.body.append(element);root=createRoot(element);await act(async()=>root?.render(<CartProvider><Probe/></CartProvider>));
 const item={id:'p',slug:'p',title:{es:'P',en:'P'},name:'P',image:'',price:50,priceUSD:50,quantity:1};
 await act(async()=>sdk.listeners[0]({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({cartItems:[item]})}));
 await act(async()=>cart.setShippingInfo({...cart.shippingInfo,name:'Synthetic',email:'synthetic@example.invalid',phone:'123'}));
 await act(async()=>checkout.pay());expect(checkout.quote?.total).toBe(100);expect(requests.filter(r=>r.action==='start')).toHaveLength(0);
 hash='b'.repeat(64);await act(async()=>checkout.pay());expect(requests.filter(r=>r.action==='start')).toHaveLength(0);
 await act(async()=>checkout.pay());expect(checkout.recovery).toBe(true);
 await act(async()=>checkout.pay());const starts=requests.filter(r=>r.action==='start');expect(starts).toHaveLength(1);const statuses=requests.filter(r=>r.action==='status');expect(statuses).toHaveLength(1);expect(statuses[0].key).toBe(starts[0].key);expect(checkout.recovery).toBe(true);
 expect(starts[0].purchase).toMatchObject({items:[{id:'p',quantity:1}]});expect(JSON.stringify(starts[0].purchase)).not.toContain('price');expect(starts[0].quoteHash).toBe(hash);
});

test('delivery apartment survives a real CartProvider remount and stays in the persisted delivery form',async()=>{
 localStorage.setItem('shippingData',JSON.stringify({name:'Invitado',address:'Calle de prueba',address2:'Apartamento 4',city:'Montevideo',state:'Montevideo',postalCode:'11000',phone:'00000000',email:'guest@example.invalid',country:'UY'}));
 const element=document.createElement('div');document.body.append(element);root=createRoot(element);
 await act(async()=>root?.render(<CartProvider><Probe/></CartProvider>));
 expect(cart.shippingInfo.address2).toBe('Apartamento 4');
 await act(async()=>cart.setShippingInfo({...cart.shippingInfo,address2:'Piso 2, apartamento 5'}));
 await act(async()=>root?.unmount());root=createRoot(element);
 await act(async()=>root?.render(<CartProvider><Probe/></CartProvider>));
 expect(cart.shippingInfo).toMatchObject({address:'Calle de prueba',address2:'Piso 2, apartamento 5',country:'UY'});
 expect(JSON.parse(localStorage.getItem('shippingData')??'{}')).toMatchObject({address2:'Piso 2, apartamento 5'});
});

const purchase={items:[{id:'p',variantId:'',quantity:1,customName:'',customNumber:''}],shipping:{pickup:true,department:'',name:'Invitado',address:'',city:'',postalCode:'',phone:'00000000',email:'guest@example.invalid'}};
test('start waits for admission and reads the replacement SDK token at the same UID before one payment request',async()=>{
 let release:((value:ReturnType<typeof active>)=>void)|undefined;
 admission.ensure.mockImplementationOnce(()=>new Promise<ReturnType<typeof active>>(resolve=>{release=resolve;}));
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:'order',init_point:'https://www.mercadopago.com.uy/checkout/synthetic'})));
 const started=startCheckout(purchase,'a'.repeat(64),'synthetic-key-never-rotated');
 expect(fetch).not.toHaveBeenCalled();
 sdk.user={uid:'ui-checkout',getIdToken:async()=>'renewed-synthetic'};
 if(!release)throw Error('Missing controlled admission');release(active(sdk.user.uid));
 await expect(started).resolves.toMatchObject({id:'order'});
 expect(admission.ensure).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
 expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({headers:{Authorization:'Bearer renewed-synthetic'}});
 expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({action:'start',key:'synthetic-key-never-rotated'});
});

test.each(['denied','foreign-admission','account-changed'] as const)('admission %s never sends a payment request',async mode=>{
 admission.ensure.mockImplementationOnce(async(user:{uid:string})=>{
  if(mode==='denied')throw Error('Capability revoked');
  if(mode==='account-changed')sdk.user={uid:'different-owner',getIdToken:async()=>'different-token'};
  return active(mode==='foreign-admission'?'different-owner':user.uid);
 });
 vi.stubGlobal('fetch',vi.fn());
 await expect(startCheckout(purchase,'a'.repeat(64),'synthetic-key-never-rotated')).rejects.toThrow(mode==='denied'?'Capability revoked':'Cambió la sesión');
 expect(fetch).not.toHaveBeenCalled();expect(admission.ensure).toHaveBeenCalledTimes(1);
});

test('a payment authorization denial is returned without another admission, request or key',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({code:'RECOVERY_REQUIRED',error:'Access denied'},{status:403})));
 await expect(startCheckout(purchase,'a'.repeat(64),'synthetic-key-never-rotated')).rejects.toMatchObject({code:'RECOVERY_REQUIRED'});
 expect(admission.ensure).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledTimes(1);
 expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).key).toBe('synthetic-key-never-rotated');
});
