import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import { test,expect,vi,afterEach } from 'vitest';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:ReturnType<typeof createRoot>;
async function waitFor(assertion:()=>void){let error:unknown;for(let i=0;i<100;i++){try{assertion();return;}catch(e){error=e;}await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});}throw error;}
const button=(name:string)=>{const found=[...document.querySelectorAll('button')].find(b=>b.textContent?.trim()===name);if(!found)throw Error('Button not found: '+name);return found;};
import {MemoryRouter} from 'react-router-dom';
vi.mock('../../src/firebase',()=>({auth:{currentUser:{getIdToken:async()=>'synthetic-token'}}}));
vi.mock('../../src/firebaseUtils',()=>({db:{}}));
// Only transport/SDK boundaries are substituted. Modal, parent, diff and API client run unchanged.
vi.mock('firebase/firestore',()=>({
 collection:(_db:unknown,...parts:string[])=>parts.join('/'),doc:vi.fn(),addDoc:vi.fn(),deleteDoc:vi.fn(),
 getDocs:async(path:string)=>{const docs=[{id:path==='categories'?'cat':'sub',data:()=>({name:path==='categories'?'Category':'Sub'})}];return {docs,forEach:(fn:(doc:typeof docs[number])=>void)=>docs.forEach(fn)};}
}));
import ProductList from '../../src/components/admin/ProductList';
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
test.each([false,true])('one save sends one PATCH; visible conflict=%s',async conflict=>{
 let product={id:'product',version:'100:1',active:true,title:{es:'Original',en:'Original'},description:'Text',images:['https://example.invalid/image'],priceUSD:100,stockTotal:2,variants:[],category:{id:'cat',name:'Category'},subcategory:{id:'sub',name:'Sub',categoryId:'cat'}};
 const patches:unknown[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,options?:RequestInit)=>{
  if(options?.method==='PATCH'){
   const body:unknown=JSON.parse(String(options.body));patches.push(body);
   if(conflict)return new Response(JSON.stringify({error:'El producto cambió mientras lo editabas.'}),{status:409});
   product={...product,title:{es:'Edited',en:'Edited'},version:'101:1'};return new Response(JSON.stringify({updated:true}));
  }
  return new Response(JSON.stringify(url.endsWith('/products')?{products:[product]}:{product}));
 }));
 const element=document.createElement('div');document.body.append(element);root=createRoot(element);
 await act(async()=>root.render(<MemoryRouter><ProductList/></MemoryRouter>));
 await waitFor(()=>expect(button('Editar')).toBeTruthy());
 await act(async()=>button('Editar').click());
 const input=document.querySelector<HTMLInputElement>('input[placeholder="Título del producto"]');if(!input)throw Error('Title input missing');
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set?.call(input,'Edited');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
 await act(async()=>button('Guardar Cambios').click());
 if(conflict){await waitFor(()=>expect(document.body.textContent).toContain('El producto cambió mientras lo editabas.'));expect(document.querySelector('[role="dialog"]')).toBeTruthy();}
 else await waitFor(()=>expect(document.querySelector('[role="dialog"]')).toBeNull());
 expect(patches).toEqual([{version:'100:1',intent:'edit',changes:{title:{es:'Edited',en:'Edited'}}}]);
});
