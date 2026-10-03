import test from 'node:test';
import assert from 'node:assert/strict';
import { findPrivateData } from '../scripts/check-public.mjs';

test('public tree check rejects private locations, contacts and credentials without returning their values',()=>{
  const samples=[
    ['/'+'Users/alice/Documents/session.json','personal-home-path'],
    ['192'+'.168.42.7','private-network-address'],
    ['device'+'.direct.zspace.link','device-direct-host'],
    ['alice'+'@gmail.com','personal-email'],
    ['ghp_'+'A'.repeat(36),'access-token'],
    ['-----BEGIN '+'PRIVATE KEY-----','private-key'],
  ];
  for(const [sample,kind] of samples){
    const findings=findPrivateData('README.md',sample);
    assert.ok(findings.some(x=>x.kind===kind));
    assert.ok(!JSON.stringify(findings).includes(sample));
  }
});

test('public reports reject private metadata and raw inventory while allowing generic examples',()=>{
  assert.deepEqual(findPrivateData('README.md','http://127.0.0.1:1234 https://nas.example.invalid /sata1/my/data maintainer@users.noreply.github.com'),[]);
  assert.ok(findPrivateData('docs/acceptance-v1.json',JSON.stringify({device:{model:'fixture'},runId:'generated',date:'fixture'})).some(x=>x.kind==='private-report-field'));
  assert.ok(findPrivateData('docs/coverage-snapshot.json','{}').some(x=>x.kind==='private-file'));
  assert.deepEqual(findPrivateData('docs/acceptance-v1.json',JSON.stringify({version:'1.0.0',checks:[{name:'synthetic note',ok:true}],privacy:{sanitized:true}})),[]);
});
