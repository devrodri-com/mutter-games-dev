import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {test,expect,vi,afterEach} from 'vitest';
const sdk=vi.hoisted(()=>({listeners:[] as ((value:unknown)=>void)[],user:{uid:'ui-checkout',getIdToken:async()=>'synthetic'}}));
vi.mock('../../src/firebase',()=>({auth:{currentUser:sdk.user},db:{}}));
vi.mock('../../src/firebaseUtils',()=>({db:{},upsertClientFromCheckout:vi.fn()}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,fn:(user:unknown)=>void)=>{fn(sdk.user);return ()=>undefined;}}));
vi.mock('react-hot-toast',()=>({toast:{error:vi.fn()}}));
vi.mock('firebase/firestore',()=>({doc:vi.fn(),collection:vi.fn(),query:vi.fn(),where:vi.fn(),limit:vi.fn(),startAfter:vi.fn(),getDocsFromServer:vi.fn(),getDocFromServer:async()=>({exists:()=>true,id:'p',data:()=>({active:true,title:'P',priceUSD:100,stockTotal:2})}),setDoc:async()=>undefined,serverTimestamp:()=>0,onSnapshot:(_ref:unknown,_options:unknown,fn:(value:unknown)=>void)=>{sdk.listeners.push(fn);return ()=>undefined;},addDoc:vi.fn(),updateDoc:vi.fn(),deleteDoc:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
import {CartProvider,useCart} from '../../src/context/CartContext';
import {useCatalogCheckout} from '../../src/hooks/useCatalogCheckout';
let cart:ReturnType<typeof useCart>;let checkout:ReturnType<typeof useCatalogCheckout>;let root:ReturnType<typeof createRoot>;
function Probe(){cart=useCart();checkout=useCatalogCheckout(true);return <div/>;}
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML='';vi.unstubAllGlobals();localStorage.clear();});
test('real cart + checkout hook reviews server amount before start and keeps one key after lost response',async()=>{
 localStorage.clear();sdk.listeners=[];const requests:Record<string,unknown>[]=[];let hash='a'.repeat(64);
 // HTTP is the external boundary. Server calculations and provider behavior have separate real-handler tests.
 vi.stubGlobal('fetch',vi.fn(async(_url:string,options:RequestInit)=>{
  const body=JSON.parse(String(options.body));requests.push(body);
  if(body.action==='quote')return new Response(JSON.stringify({quote:{total:100,currency:'UYU',shippingCost:0,hash,items:[{id:'p',title:'P',variantId:'',quantity:1,unitPrice:100,stock:2}]}}));
  throw new Error('HTTP response lost');
 }));
 const element=document.createElement('div');document.body.append(element);root=createRoot(element);await act(async()=>root.render(<CartProvider><Probe/></CartProvider>));
 const item={id:'p',slug:'p',title:{es:'P',en:'P'},name:'P',image:'',price:50,priceUSD:50,quantity:1};
 await act(async()=>sdk.listeners[0]({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({cartItems:[item]})}));
 await act(async()=>cart.setShippingInfo({...cart.shippingInfo,name:'Synthetic',email:'synthetic@example.invalid',phone:'123'}));
 await act(async()=>checkout.pay());expect(checkout.quote?.total).toBe(100);expect(requests.filter(r=>r.action==='start')).toHaveLength(0);
 hash='b'.repeat(64);await act(async()=>checkout.pay());expect(requests.filter(r=>r.action==='start')).toHaveLength(0);
 await act(async()=>checkout.pay());expect(checkout.recovery).toBe(true);
 await act(async()=>checkout.pay());const starts=requests.filter(r=>r.action==='start');expect(starts).toHaveLength(2);expect(starts[0].key).toBe(starts[1].key);
 expect(starts[0].purchase).toMatchObject({items:[{id:'p',quantity:1}]});expect(JSON.stringify(starts[0].purchase)).not.toContain('price');expect(starts[0].quoteHash).toBe(hash);
});
