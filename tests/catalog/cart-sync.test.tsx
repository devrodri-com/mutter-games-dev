import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test,expect,vi,beforeEach,afterEach } from 'vitest';
const boundary=vi.hoisted(()=>({auth:{currentUser:{uid:'synthetic-cart'}},listeners:[] as ((snap:unknown)=>void)[],authListeners:[] as ((user:unknown)=>void)[],write:vi.fn(),read:vi.fn()}));
vi.mock('../../src/firebase',()=>({auth:boundary.auth,db:{}}));
vi.mock('../../src/firebaseUtils',()=>({db:{}}));
vi.mock('react-hot-toast',()=>({toast:{error:vi.fn()}}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:unknown,callback:(user:unknown)=>void)=>{boundary.authListeners.push(callback);callback(boundary.auth.currentUser);return ()=>{boundary.authListeners=boundary.authListeners.filter(fn=>fn!==callback);};}}));
vi.mock('firebase/firestore',()=>({doc:(_db:unknown,collection:string,id:string)=>({collection,id}),collection:vi.fn(),query:vi.fn(),where:vi.fn(),limit:vi.fn(),startAfter:vi.fn(),getDocsFromServer:vi.fn(),getDocFromServer:(ref:unknown)=>boundary.read(ref),setDoc:(...args:unknown[])=>boundary.write(...args),serverTimestamp:()=>0,onSnapshot:(_ref:unknown,_options:unknown,callback:(snapshot:unknown)=>void)=>{boundary.listeners.push(callback);return ()=>{boundary.listeners=boundary.listeners.filter(cb=>cb!==callback);};},addDoc:vi.fn(),updateDoc:vi.fn(),deleteDoc:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
import { CartProvider,useCart } from '../../src/context/CartContext';
let context:ReturnType<typeof useCart>|undefined;let root:ReturnType<typeof createRoot>;
const item={id:'p',slug:'p-game',name:'Old',title:{es:'Old',en:''},priceUSD:10,price:10,quantity:1,image:''};
function Probe(){context=useCart();return <div>{context.items.length}</div>;}
function snapshot(items:unknown[]){return {metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({cartItems:items})};}
const current=()=>({exists:()=>true,id:'p',data:()=>({active:true,title:'Current',priceUSD:20,stockTotal:2})});
beforeEach(async()=>{localStorage.clear();boundary.auth.currentUser={uid:'synthetic-cart'};boundary.authListeners=[];boundary.listeners=[];boundary.write.mockReset().mockResolvedValue(undefined);boundary.read.mockReset().mockResolvedValue(current());const element=document.createElement('div');document.body.append(element);root=createRoot(element);await act(async()=>root.render(<CartProvider><Probe/></CartProvider>));});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
test('remote restore revalidates price; late validation cannot repopulate explicit clear',async()=>{
 await act(async()=>boundary.listeners[0](snapshot([item])));expect(context?.items[0].priceUSD).toBe(20);
 let resolve:((value:ReturnType<typeof current>)=>void)|undefined;
 boundary.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 await act(async()=>boundary.listeners[0](snapshot([item])));
 await act(async()=>context?.clearCart());expect(context?.items).toEqual([]);
 await act(async()=>resolve?.(current()));expect(context?.items).toEqual([]);
 expect(boundary.write.mock.calls.at(-1)?.[1].cartItems).toEqual([]);
 expect(JSON.parse(localStorage.getItem('mutter-cart:synthetic-cart')||'{}')).toMatchObject({items:[],dirty:false});
});
test('catalog network failure preserves the cart and blocks readiness',async()=>{
 await act(async()=>boundary.listeners[0](snapshot([item])));boundary.read.mockRejectedValueOnce(new Error('Catalog network failed'));
 await act(async()=>{await expect(context?.refreshCart()).rejects.toThrow('Catalog network failed');});
 expect(context?.items).toHaveLength(1);expect(context?.cartReady).toBe(false);expect(context?.cartError).toBe('Catalog network failed');
});
test('failed last-item remote clear stays visibly pending for retry after reload',async()=>{
 await act(async()=>boundary.listeners[0](snapshot([item])));boundary.write.mockRejectedValueOnce(new Error('Remote unavailable'));
 await act(async()=>context?.removeItem(item));expect(context?.items).toEqual([]);expect(context?.cartError).toBe('Remote unavailable');
 expect(JSON.parse(localStorage.getItem('mutter-cart:synthetic-cart')||'{}')).toMatchObject({items:[],dirty:true});
 await act(async()=>boundary.listeners[0](snapshot([item])));expect(context?.items).toEqual([]);
 await act(async()=>context?.refreshCart());expect(boundary.write.mock.calls.at(-1)?.[1].cartItems).toEqual([]);
 expect(JSON.parse(localStorage.getItem('mutter-cart:synthetic-cart')||'{}')).toMatchObject({items:[],dirty:false});
});

test('an add awaiting catalog cannot undo a later explicit clear',async()=>{
 await act(async()=>boundary.listeners[0](snapshot([item])));
 let resolve:((value:ReturnType<typeof current>)=>void)|undefined;
 boundary.read.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 let adding:Promise<boolean>|undefined;
 await act(async()=>{adding=context?.addToCart(item);});
 await act(async()=>context?.clearCart());
 await act(async()=>{resolve?.(current());expect(await adding).toBe(false);});
 expect(context?.items).toEqual([]);
});

test('removing one customized line preserves another line of the same product',async()=>{
 await act(async()=>boundary.listeners[0](snapshot([{...item,customName:'A'},{...item,customName:'B'}])));
 await act(async()=>context?.removeItem({...item,customName:'A'}));
 expect(context?.items.map(i=>i.customName)).toEqual(['B']);
 expect(boundary.write.mock.calls.at(-1)?.[1].cartItems).toHaveLength(1);
});

test('switching from anonymous UID to an authenticated UID cannot write the previous cart',async()=>{
 const oldListener=boundary.listeners[0];await act(async()=>oldListener(snapshot([item])));
 await act(async()=>{boundary.auth.currentUser={uid:'registered-user'};boundary.authListeners[0](boundary.auth.currentUser);});
 await act(async()=>boundary.listeners[0](snapshot([item])));
 await act(async()=>context?.clearCart());await act(async()=>oldListener(snapshot([item])));
 expect(context?.items).toEqual([]);expect(boundary.write.mock.calls.map(call=>call[0].id)).toEqual(['registered-user']);
 expect(JSON.parse(localStorage.getItem('mutter-cart:registered-user')||'{}')).toMatchObject({items:[],dirty:false});
});
