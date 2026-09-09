// @vitest-environment node
import { beforeAll, afterAll, test, expect, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import { mapCatalogProduct, currentCartItem } from '../../src/domain/catalog';
import { editProductChanges } from '../../src/domain/productEdit';
const fixtures=vi.hoisted(()=>({db:undefined as ReturnType<typeof getFirestore>|undefined}));
vi.mock('../../src/firebaseUtils',()=>({get db(){return fixtures.db;}}));
const {fetchProductsPage,fetchProducts,fetchProductBySlug,fetchProductsByCategory,fetchProductById}=await import('../../src/firebase/products');
const host=process.env.FIRESTORE_EMULATOR_HOST;if(!host||!/^127\.0\.0\.1:\d+$/.test(host))throw Error('Isolated emulator required');
const app=initializeApp({projectId:'demo-mutter-readers',apiKey:'synthetic'},'readers');const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',Number(host.split(':')[1]));fixtures.db=db;
const values=[true,false,undefined,null,'true',1];
const base={title:'Legacy',priceUSD:100,stockTotal:4,category:{id:'games',name:'Games'},subcategory:{id:'sub',name:'Sub',categoryId:'games'},variants:[],images:[]};
beforeAll(async()=>{await fetch(`http://${host}/emulator/v1/projects/demo-mutter-readers/databases/(default)/documents`,{method:'DELETE'});for(let i=0;i<values.length;i++)await setDoc(doc(db,'products',`product${i}`),{...base,slug:`product${i}-legacy`,...(values[i]!==undefined?{active:values[i]}:{})});});
afterAll(()=>deleteApp(app));
test('publication matrix applies to actual paginated, search and related queries',async()=>{
 expect((await fetchProductsPage({limit:1})).products.map(p=>p.id)).toEqual(['product0']);
 expect((await fetchProducts()).map(p=>p.id)).toEqual(['product0']);
 expect((await fetchProductsByCategory('Games')).map(p=>p.id)).toEqual(['product0']);
});
test.each(values.map((active,i)=>({active,i})))('detail and restored cart: $active',async({active,i})=>{
 const product=await fetchProductBySlug(`product${i}-legacy`);expect(Boolean(product)).toBe(active===true);
 expect(Boolean(await fetchProductById(`product${i}`))).toBe(active===true);
 const item={id:`product${i}`,slug:`product${i}-legacy`,name:'Old',title:{es:'Old',en:'Old'},price:1,priceUSD:1,quantity:1,image:''};
 const current=currentCartItem(item,product);expect(current.availability).toBe(active===true?'available':'unavailable');if(active===true){expect(current.priceUSD).toBe(100);expect(current.priceChanged).toBe(true);}
});
test('editor normalization is not an edit; publication never leaves general save',()=>{
 const original=mapCatalogProduct('p',{...base,active:false});
 expect(editProductChanges(original,{...original,active:true})).toEqual({});
 expect(editProductChanges(original,{...original,description:'New'})).toEqual({description:'New'});
});
