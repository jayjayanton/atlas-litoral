import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {nearbyParishIncome, queryCampaignParishes} from '../docs/parish-income.js';
import {groupMunicipalParishes} from '../docs/parishes.js';

const point = {lat:0, lon:0};
const ring = (w,s,e,n) => [[w,s],[e,s],[e,n],[w,n],[w,s]];
const parish = (code,west) => ({
  properties:{code,name:code,kind:'Parroquia rural',canton:'0901'},
  geometry:{type:'Polygon',coordinates:[ring(west,-0.01,west+0.01,0.01)]}
});
const refs = {'09':[0.02,0.2,0.8,0.6].map(share=>({shares:[share,1-share,0,0,0]}))};
const query = (parishes,households,options={}) =>
  nearbyParishIncome({point,band:0,parishes,households,provinces:refs,...options});

test('income uses household representative age; unknown age stays out of the denominator', () => {
  const rows = query([parish('090150',-0.005)], {'090150':[0,90,10,0,25]});
  assert.equal(rows[0].estimatedHouseholds,26);
  assert.equal(rows[0].share,0.26);
  assert.equal(rows[0].eligibleHouseholds,100);
  assert.equal(rows[0].totalHouseholds,125);
  assert.equal(rows[0].unknownHouseholds,25);
  assert.equal(rows[0].distanceKm,0);
  assert.deepEqual(query([parish('090150',0)],{'090150':[0,0,0,0,25]}),[]);
  assert.deepEqual(query([parish('090150',0)],{'090150':[0,10,0,0,0]},{band:4}),[]);
});

test('matches the full-precision threshold before ranking by proximity and limiting to five', () => {
  const areas=Array.from({length:8},(_,i)=>parish('0901'+String(50+i),i*0.1));
  const counts=Object.fromEntries(areas.map(({properties:{code}})=>[code,[0,0,10,0,0]]));
  counts['090150']=[99,1,0,0,0]; // 2.18 percent before rounding.
  const selected=query(areas.slice().reverse(),counts,{minShare:0.02181});
  assert.deepEqual(selected.map(r=>r.code),['090151','090152','090153','090154','090155']);
  assert.ok(selected[0].distanceKm>11 && selected[0].distanceKm<11.2);
  assert.equal(query(areas,counts,{minShare:0.8}).length,5);
  assert.deepEqual(query(areas,counts,{minShare:0.81}),[]);
  assert.deepEqual(query(areas,counts,{point:{lat:NaN,lon:0}}),[]);
});

test('distance respects holes, touching boundaries, and every part of a parish', () => {
  const island=parish('090150',2);
  island.geometry={type:'MultiPolygon',coordinates:[
    [ring(-1,-1,1,1),ring(-0.25,-0.25,0.25,0.25)],
    [ring(2,-0.1,2.1,0.1)]
  ]};
  const at = (lat,lon)=>query([island],{'090150':[1,1,1,1,0]},{point:{lat,lon}})[0].distanceKm;
  assert.ok(at(0,0)>27.7 && at(0,0)<27.9);
  assert.equal(at(0,0.5),0);
  assert.equal(at(0,1),0);
  assert.equal(at(0,2.05),0);
  assert.ok(at(0,2.11)>1.1 && at(0,2.11)<1.12);
});

test('municipal mode replaces the census cabecera, retaining other census parishes', () => {
  const areas=[parish('090150',0),parish('090152',0.2)];
  const counts={'090150':[3,3,3,3,0],'090152':[4,4,4,4,0]};
  const urbanParishes=[parish('gye-TARQUI',0),parish('gye-ROCA',0.1)];
  const urbanHouseholds={'gye-TARQUI':[1,1,1,1,0],'gye-ROCA':[2,2,2,2,0]};
  const rows=query(areas,counts,{urbanParishes,urbanHouseholds});
  assert.deepEqual(rows.map(r=>r.code),['gye-TARQUI','gye-ROCA','090152']);
  assert.deepEqual(rows.map(r=>r.municipal),[true,true,false]);
  assert.deepEqual(query(areas,counts).map(r=>r.code),['090150','090152']);
  assert.throws(()=>query(areas,counts,{urbanHouseholds}));
});

const data = new URL('../docs/data/',import.meta.url);
const read = name => JSON.parse(readFileSync(new URL(name,data)));
test('municipal boundaries and household counts produce five distinct parishes around VELIN', () => {
  const urbanParishes=groupMunicipalParishes(read('guayaquil-urban.json').features);
  const {households:urbanHouseholds,coverage}=read('guayaquil-urban-households.json');
  const households=read('parish-income-households.json');
  assert.equal(urbanParishes.length,15);
  assert.deepEqual(urbanParishes.map(f=>f.properties.code).sort(),Object.keys(urbanHouseholds).sort());
  assert.equal(Object.values(urbanHouseholds).flat().reduce((a,b)=>a+b,0),coverage.assignedHouseholds);
  assert.equal(coverage.assignedHouseholds,721373);
  assert.ok(coverage.assignedHouseholds<=coverage.mappedHouseholds);
  assert.ok(coverage.mappedHouseholds<=households['090150'].reduce((a,b)=>a+b,0));
  const rows=nearbyParishIncome({point:read('buildings.json')[0],band:2,parishes:read('parishes.json').features,
    provinces:read('sectors/index.json').provinces,households,urbanParishes,urbanHouseholds});
  assert.deepEqual(rows.map(r=>r.name),['TARQUI','FEBRES CORDERO','LETAMENDI','PASCUALES','XIMENA']);
  assert.ok(rows.every(r=>r.municipal && r.code!=='090150'));
  assert.deepEqual(rows.map(r=>r.distanceKm.toFixed(1)),['0.0','4.2','6.9','7.0','7.3']);
});

test('all 65 census parishes reconcile with mapped and pooled private households', () => {
  const counts=read('parish-income-households.json');
  const parishes=read('parishes.json').features;
  const index=read('sectors/index.json');
  const total=group=>group.reduce((sum,n)=>sum+n,0);
  assert.deepEqual(Object.keys(counts).sort(),parishes.map(f=>f.properties.code).sort());
  assert.equal(Object.keys(counts).length,65);
  assert.equal(total(Object.values(counts).map(total)),1426239);
  assert.equal(total(Object.values(counts).map(group=>group[4])),1144);
  const mapped={};
  for (const file of new Set(Object.values(index.zones).map(zone=>zone[0]))) {
    const zones=JSON.parse(gunzipSync(readFileSync(new URL('sectors/'+file,data))));
    for (const [zone,sectors] of Object.entries(zones)) {
      const row=mapped[zone.slice(0,6)]??=[0,0,0,0,0];
      for (const [id,values] of sectors) {
        for (let i=0;i<4;i++) row[i]+=values[i+4];
        row[4]+=index.withoutAgeBySector[zone+id]||0;
      }
    }
  }
  for (const [code,groups] of Object.entries(mapped)) {
    groups.forEach((mappedCount,i)=>assert.ok(mappedCount<=counts[code][i],code));
  }
  assert.equal(total(Object.values(counts).map(total))-total(Object.values(mapped).map(total)),
    index.coverage.pooledHouseholds);
  const [first,second]=nearbyParishIncome({point:read('buildings.json')[0],band:4,
    parishes,households:counts,provinces:index.provinces});
  assert.equal(first.code,'090150');
  assert.equal(first.distanceKm,0);
  assert.equal((first.share*100).toFixed(2),'6.82');
  assert.equal(second.code,'090750');
  assert.equal(second.distanceKm.toFixed(2),'11.42');
});

test('similarity searches the complete catalog and excludes only the reference', () => {
  const areas=Array.from({length:8},(_,i)=>parish('0901'+String(50+i),i===0?-.005:i*.1));
  const values=[80,21,37,60,94,74,82,80.05];
  const scores=new Map(areas.map(({properties:p},i)=>[p.code,{score:values[i],cells:5,validCells:5}]));
  const result=queryCampaignParishes({point,method:'similar',parishes:areas,scores});
  assert.equal(result.reference.code,'090150');
  assert.equal(result.matchedCount,7);
  assert.deepEqual(result.rows.map(r=>r.code),['090157','090156','090155','090154','090153']);
  assert.equal(result.rows[1].difference,2);
  const manual=queryCampaignParishes({method:'similar',referenceCode:'090156',parishes:areas,scores});
  assert.equal(manual.reference.code,'090156');
  assert.equal(manual.rows[0].code,'090157');
  assert.equal(manual.rows[0].distanceKm,null);
  scores.delete('090156');
  const missing=queryCampaignParishes({method:'similar',referenceCode:'090156',parishes:areas,scores});
  assert.equal(missing.reference.score,null);
  assert.deepEqual(missing.rows,[]);
});

test('regional score thresholds support exact endpoints, income intersections and stable ties', () => {
  const areas=[parish('090150',-.005),parish('090151',.3),parish('090152',.1),parish('090153',.9)];
  const scores=new Map(areas.map(({properties:p},i)=>[p.code,{score:[79.999,80,80,100][i],cells:7,validCells:7}]));
  const run=(args={})=>queryCampaignParishes({method:'minimum',minScore:80,parishes:areas,scores,...args});
  assert.deepEqual(run().rows.map(r=>r.code),['090153','090151','090152']);
  assert.deepEqual(run({point}).rows.map(r=>r.code),['090153','090152','090151']);
  assert.deepEqual(run({minScore:100}).rows.map(r=>r.code),['090153']);
  assert.deepEqual(run({minScore:101}).rows,[]);
  const households={'090151':[0,0,30,0,0],'090152':[0,40,0,0,0]};
  assert.deepEqual(run({band:0,minShare:.3,households,provinces:refs}).rows.map(r=>r.code),['090151']);
  assert.equal(run({band:0,minShare:.3,minScore:100,households,provinces:refs}).maxScore,80);
});
