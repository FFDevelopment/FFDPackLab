import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
const source=readFileSync('index.html','utf8');
const scripts=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(Boolean);
const main=scripts.find(x=>x.includes('function portfolioHasAutomaticPrice'));
assert.ok(main,'main script missing');
function section(a,b){const start=main.indexOf(a),end=main.indexOf(b,start+a.length);assert.ok(start>=0&&end>start,a+' section absent');return main.slice(start,end)}
const code=[
 section('function portfolioHasAutomaticPrice(row){','function portfolioUnitValue(row){'),
 section('function tcgdexCardKey(card){','function priceTime(t){'),
 section('function quoteRows(tcg){','function realPriceTable(payload){'),
 section('const physicalSetCache={promise:null};','const portfolioFetches=new Set();')
].join('\n');
const good={id:'sv03.5-006',name:'Charizard ex',localId:'006',set:{name:'151'},variants:{normal:false,holo:true,reverse:false},pricing:{tcgplayer:{unit:'USD',updated:'2026-10-19T12:00:00Z',holofoil:{marketPrice:7.40,lowPrice:6.00}}}};
const list=[{id:'sv03.5-006',name:'Charizard ex',localId:'006'},{id:'sv99-006',name:'Charizard ex',localId:'006'}];
const sets=[{id:'sv03.5',name:'151'},{id:'sv99',name:'Different Expansion'}];
const called=[];
async function fetchMock(url){called.push(url);let data;
 if(url.includes('/cards/sv03.5-006'))data=good;
 else if(url.includes('/cards/sv99-006'))data={...good,id:'sv99-006',set:{name:'Different Expansion'}};
 else if(url.includes('/cards?'))data=list;
 else if(url.endsWith('/sets'))data=sets;
 else return {ok:false,status:404,json:async()=>null};
 return {ok:true,json:async()=>data}
}
const ctx=createContext({SETS:{sv3pt5:{tcgdex:'sv03.5'}},URLSearchParams,fetch:fetchMock,Date,console});
runInContext(code+'\nthis.api={portfolioHasAutomaticPrice,resolvePhysicalCard,portfolioMarketQuote,physicalSetLabel,physicalCardNumber}',ctx);
const api=ctx.api;
const entry={name:'Charizard ex',number:'006/165',setName:'Scarlet & Violet—151',setId:'sv3pt5',finish:'Holo Foil',language:'English',condition:'Near Mint',grader:'Raw',pricingMode:'market'};
assert.equal(api.portfolioHasAutomaticPrice(entry),true);
const resolved=await api.resolvePhysicalCard(entry);
assert.equal(resolved.id,'sv03.5-006');
assert.equal(api.portfolioMarketQuote(entry,resolved).value,7.4);
assert.equal(api.portfolioMarketQuote({...entry,finish:'Reverse Holo'},resolved),null,'never borrow wrong foil quote');
const autodetect=api.portfolioMarketQuote({...entry,finish:'Normal'},resolved);
assert.equal(autodetect.detectedFinish,'Holo Foil');
assert.equal(api.portfolioMarketQuote(entry,{...resolved,pricing:{}}),null,'no made-up market price');
const other={...entry,setId:'other',tcgdexId:'',number:'6',setName:'151'};
assert.equal((await api.resolvePhysicalCard(other)).id,'sv03.5-006','external sets matched by exact set/name/number');
await assert.rejects(()=>api.resolvePhysicalCard({...other,setName:'Wrong Set'}),/set name does not match/i);
assert.equal(api.physicalCardNumber('006/165'),'6');
assert.equal(api.physicalSetLabel('Scarlet & Violet—151'),'151');
assert.ok(called.some(x=>x.includes('/cards?')),'manual entry must call card search');
// Card-box geometry and smoothing tests.
const tracker=section("let centerCameraMode='auto'","function cameraQuadDistance(a,b){");
const cam=createContext({Date,Math,console});
runInContext(tracker+'\nthis.geom={cameraValidQuad,cameraBlendQuad}',cam);
const a=[{x:25,y:10},{x:75,y:10},{x:75,y:80},{x:25,y:80}];
const b=[{x:25,y:10},{x:75,y:10},{x:75,y:60},{x:25,y:60}];
assert.equal(cam.geom.cameraValidQuad(a),true,'0.714 Pokémon card ratio');
assert.equal(cam.geom.cameraValidQuad(b),false,'square is not Pokémon card geometry');
assert.ok(cam.geom.cameraBlendQuad(a,a.map(p=>({x:p.x+10,y:p.y+10})))[0].x<35,'smooth new positions rather than jump');
// Exercise the tracking loop with mocked detections to guard against frame-to-frame box jumps.
const camFunctions=section("let centerCameraMode='auto'","function updateCameraModeLabel(){")
 +'\n'+section("function scanLiveCamera(request){","function showCameraDialog(){");
const frames=[],statuses=[],queue=[];
const detector={
 detectOuterFlexible:()=>queue.shift()||{ok:false},
 cornersFromFrac:q=>q,
 photoQuality:()=>({blurry:false,glareRisk:false})
};
const cvm=createContext({Date,Math,console,window:{PackLabVision:detector},setTimeout:()=>1,requestAnimationFrame:()=>{},captureCenterPhoto:()=>{}});
runInContext(`let centerCameraRequest=1,centerCameraStream={},cameraDetectTimer=null;
 const ui={scanHolder:false};
 function cameraLayer(){return {hidden:false};}
 function captureCameraStage(){return {width:380,height:380};}
 function cameraStatus(s){statuses.push(s);}
 function updateCameraDetectedOutline(quad,visible,locked){frames.push({quad:quad?.map(p=>({...p}))||[],visible,locked});}
`+camFunctions+'\ncenterCameraMode="manual";this.drive=scanLiveCamera;this.state=()=>cameraTrack',cvm);
cvm.statuses=statuses;cvm.frames=frames;
const a2=a.map(p=>({x:p.x+17,y:p.y}));
function sample(quad){queue.push(quad?{ok:true,confidence:'high',quad}:{ok:false});cvm.drive(1);}
sample(a);sample(a);assert.equal(cvm.state().quad,null,'no polygon before three consistent candidates');
sample(a);assert.equal(cvm.state().quad[0].x,25);
sample(a2);assert.equal(cvm.state().quad[0].x,25,'single outlier must not move box');
sample(a);assert.equal(cvm.state().quad[0].x,25,'stable card stays in place after transient outlier');
sample(a2);sample(a2);sample(a2);assert.equal(cvm.state().quad[0].x,42,'new stable position eventually accepted');
runInContext('cameraTrack.lastSeen=Date.now()-1500;cameraTrack.startedAt=Date.now()-4500',cvm);
sample(null);assert.ok(statuses.at(-1).includes('FLAT'),'unrecognized cards get flat-surface advice');

console.log('PASS: verified ID + set + collector number, raw finish prices, rejected mismatches, camera geometry');
