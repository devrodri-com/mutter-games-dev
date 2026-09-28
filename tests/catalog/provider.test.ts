// @vitest-environment node
import { test,expect,vi,afterEach } from 'vitest';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import { parsePurchase,quotePurchase } from '../../api/_lib/checkout-domain';
const quote=quotePurchase(parsePurchase({items:[{id:'p',quantity:1}],shipping:{pickup:true,department:'',name:'Test',address:'',city:'',postalCode:'',phone:'123',email:'test@example.invalid'}}),new Map([['p',{active:true,title:'P',stockTotal:1,priceUSD:50}]]));
afterEach(()=>{vi.unstubAllGlobals();delete process.env.MP_ACCESS_TOKEN;});
test('provider receives canonical UYU values and stable reference; no assumed idempotency header',async()=>{
 process.env.MP_ACCESS_TOKEN='synthetic';const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'pref',collector_id:200,external_reference:'intent',init_point:'https://www.mercadopago.com.uy/checkout/test'})});vi.stubGlobal('fetch',fetcher);
 await createMercadoPagoPreference('intent',quote,Date.now()+60000);
 const options=fetcher.mock.calls[0][1];expect(JSON.parse(options.body)).toMatchObject({external_reference:'intent',items:[{id:'p',unit_price:50,currency_id:'UYU',quantity:1}]});expect(options.headers['X-Idempotency-Key']).toBeUndefined();
 const payload=JSON.parse(options.body);expect(payload.expires).toBe(true);expect(Date.parse(payload.expiration_date_to)).toBeGreaterThan(Date.parse(payload.expiration_date_from));expect(payload.back_urls).toEqual({success:'https://www.muttergames.com/success?orderId=intent',pending:'https://www.muttergames.com/success?orderId=intent',failure:'https://www.muttergames.com/success?orderId=intent'});expect(payload.binary_mode).toBeUndefined();expect(payload.payment_methods).toBeUndefined();
});
test('provider timeout and mismatched reference never become success',async()=>{
 process.env.MP_ACCESS_TOKEN='synthetic';vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('Timeout')));await expect(createMercadoPagoPreference('intent',quote,Date.now()+60000)).rejects.toThrow();
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'pref',external_reference:'other',init_point:'https://www.mercadopago.com.uy/checkout/test'})}));await expect(createMercadoPagoPreference('intent',quote,Date.now()+60000)).rejects.toThrow();
});
test.each([undefined,0,-1,'seller',Number.MAX_SAFE_INTEGER+1])('missing or invalid provider collector %s requires recovery',async collector_id=>{
 process.env.MP_ACCESS_TOKEN='synthetic';vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'pref',collector_id,external_reference:'intent',init_point:'https://www.mercadopago.com.uy/checkout/test'})}));
 await expect(createMercadoPagoPreference('intent',quote,Date.now()+60000)).rejects.toThrow();
});
test.each(['http://www.mercadopago.com.uy/checkout/test','https://foreign.invalid/checkout/test','https://user:pass@www.mercadopago.com.uy/checkout/test','https://www.mercadopago.com.uy:444/checkout/test'])('untrusted provider redirect %s is rejected',async init_point=>{
 process.env.MP_ACCESS_TOKEN='synthetic';vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'pref',collector_id:200,external_reference:'intent',init_point})}));
 await expect(createMercadoPagoPreference('intent',quote,Date.now()+60000)).rejects.toThrow();
});
test('expired preference request fails before a provider POST',async()=>{
 process.env.MP_ACCESS_TOKEN='synthetic';const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(createMercadoPagoPreference('intent',quote,Date.now()-1)).rejects.toThrow('lifetime');expect(fetcher).not.toHaveBeenCalled();
});
