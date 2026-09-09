// Start only the local demo SPA; browser tests reject every non-loopback request.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9198')throw Error('Local emulators required');
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5277','--strictPort'],{env:{...process.env,VITE_USE_FIREBASE_EMULATORS:'true',VITE_FIREBASE_PROJECT_ID:'demo-mutter-r1',VITE_FIREBASE_API_KEY:'synthetic',VITE_FIREBASE_AUTH_DOMAIN:'localhost',VITE_ADMIN_API_URL:'http://127.0.0.1:5278'},stdio:['ignore','ignore','inherit']});
try {
 let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('Demo server exited');try{const response=await fetch('http://127.0.0.1:5277');if(response.ok){ready=true;break;}}catch{/* Local startup may take a moment. */}await new Promise(resolve=>setTimeout(resolve,100));}
 if(!ready)throw Error('Demo server unavailable');
 const tests=spawn(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','scripts/catalog-playwright.config.ts'],{env:process.env,stdio:'inherit'});
 const [code]=await once(tests,'exit');process.exitCode=typeof code==='number'?code:1;
}finally{server.kill('SIGTERM');}
