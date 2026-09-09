// @vitest-environment node
import { test,expect,vi,afterEach } from 'vitest';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import { parsePurchase,quotePurchase } from '../../api/_lib/checkout-domain';
const quote=quotePurchase(parsePurchase({items:[{id:'p',quantity:1}],shipping:{pickup:true,department:'',name:'Test',address:'',city:'',postalCode:'',phone:'123',email:'test@example.invalid'}}),new Map([['p',{active:true,title:'P',stockTotal:1,priceUSD:50}]]));
afterEach(()=>{vi.unstubAllGlobals();delete process.env.MP_ACCESS_TOKEN;});
test('provider receives canonical UYU values and stable reference; no assumed idempotency header',async()=>{
 process.env.MP_ACCESS_TOKEN='synthetic';const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'pref',external_reference:'intent',init_point:'https://www.mercadopago.com.uy/checkout/test'})});vi.stubGlobal('fetch',fetcher);
 await createMercadoPagoPreference('intent',quote);
 const options=fetcher.mock.calls[0][1];expect(JSON.parse(options.body)).toMatchObject({external_reference:'intent',items:[{id:'p',unit_price:50,currency_id:'UYU',quantity:1}]});expect(options.headers['X-Idempotency-Key']).toBeUndefined();
});
test('provider timeout and mismatched reference never become success',async()=>{
 process.env.MP_ACCESS_TOKEN='synthetic';vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Timeout')));await expect(createMercadoPagoPreference('intent',quote)).rejects.toThrow();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'pref',external_reference:'other',init_point:'https://www.mercadopago.com.uy/checkout/test'})}));await expect(createMercadoPagoPreference('intent',quote)).rejects.toThrow();
});
