// Uses the already installed Vercel builder; never links, pulls env, installs or deploys.
const {build}=require('@vercel/node');
const {glob}=require('@vercel/build-utils');
const {readFileSync}=require('node:fs');
(async()=>{
 const config=JSON.parse(readFileSync('vercel.json','utf8'));
 const functions=config.builds.filter(b=>b.use==='@vercel/node');
 if(functions.length!==1||functions[0].src!=='api/create-mp-preference.ts')throw Error('Unexpected function topology');
 const files=await glob('api/**/*.ts',process.cwd());
 const result=await build({files,entrypoint:functions[0].src,workPath:process.cwd(),config:{},meta:{isDev:true}});
 const output=result.output;
 for(const name of ['api/create-mp-preference.js','api/_lib/checkout-service.js','api/_lib/checkout-domain.js','api/_lib/mercado-pago.js'])if(!output.files[name])throw Error(`Missing traced module ${name}`);
 console.log(JSON.stringify({functions:1,handler:output.handler,runtime:output.runtime,tracedFiles:Object.keys(output.files).length,mode:'Installed Vercel builder with isDev to skip installation; no deployment'}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
