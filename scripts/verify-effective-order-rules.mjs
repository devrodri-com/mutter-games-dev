import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {initializeTestEnvironment,assertSucceeds} from '@firebase/rules-unit-testing';
const directory=process.argv[2];if(!directory?.startsWith('/Users/lolo/PrivateBackups/mutter-catalog-r1-'))throw Error('Private source required');
const source=JSON.parse(readFileSync(`${directory}/effective-rules-private.json`,'utf8')).source.files[0].content;
const env=await initializeTestEnvironment({projectId:'demo-mutter-effective-rules',firestore:{host:'127.0.0.1',port:8188,rules:source}});
try{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(ctx=>ctx.firestore().collection('products').doc('synthetic-withdrawn').set({active:false,priceUSD:1000,stockTotal:0}));
 await assertSucceeds(env.authenticatedContext('synthetic-user').firestore().collection('orders').doc('synthetic-bypass').set({uid:'synthetic-user',createdAt:1,items:[{id:'synthetic-withdrawn',priceUSD:1,quantity:999}],shipping:{},total:1}));
 const evidence={rulesSha256:createHash('sha256').update(source).digest('hex'),result:'BYPASS_REPRODUCED_WITH_EFFECTIVE_RULES_IN_EMULATOR',productionWrites:0,project:'demo-mutter-effective-rules',boundary:'Customer can directly create an order for an inactive product with invented total and quantity',requiredAction:'Cerebro must coordinate a separately scoped Rules repair before release'};
 writeFileSync(`${directory}/effective-rules-regression.json`,JSON.stringify(evidence,null,2),{mode:0o600});console.log(JSON.stringify(evidence));
}finally{await env.cleanup();}
