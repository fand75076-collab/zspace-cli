import { execFileSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const rules = [
  ['personal-home-path', /(?:\/Users\/[^/\s]+\/|[A-Z]:\\Users\\[^\\\s]+\\|\/home\/[^/\s]+\/(?:\.config|\.ssh|Documents)\/)/i],
  ['private-network-address', /\b(?:192\.168\.(?:\d{1,3}\.)\d{1,3}|10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
  ['device-direct-host', /(?:[a-z0-9-]+\.)+direct\.zspace\.link/i],
  ['personal-email', /[\w.+-]+@(?:gmail|qq|outlook|icloud|hotmail|163|126)\.com\b/i],
  ['access-token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,})/],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const privateReportKeys = new Set(['model','device','device_id','serial','hostname','address','username','profile','cookies','token','timestamp','date','runId','installedApplications']);

export function findPrivateData(path, text) {
  const findings = rules.filter(([,pattern])=>pattern.test(text)).map(([kind])=>({path,kind}));
  if (/(?:^|\/)(?:\.env(?:\..+)?|config\.json)$|\.har$|^docs\/coverage-snapshot\.json$/i.test(path) && !path.endsWith('.env.example')) findings.push({path,kind:'private-file'});
  if (/^docs\/acceptance.*\.json$/.test(path)) {
    try {
      const walk=value=>{
        if (!value || typeof value!=='object') return;
        for (const [key,child] of Object.entries(value)) {
          if (privateReportKeys.has(key)) findings.push({path,kind:'private-report-field',field:key});
          walk(child);
        }
      };
      walk(JSON.parse(text));
    } catch { findings.push({path,kind:'invalid-report-json'}); }
  }
  return findings;
}

export async function checkPublicTree(root=process.cwd()) {
  const names=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const findings=[];
  for (const path of new Set(names)) {
    const full=resolve(root,path);
    let stat;
    try { stat=await lstat(full); } catch(e) { if(e.code==='ENOENT')continue;throw e; }
    if(stat.isSymbolicLink()){findings.push({path,kind:'symlink-needs-review'});continue;}
    if(stat.isFile())findings.push(...findPrivateData(path,await readFile(full,'utf8')));
  }
  return {files:new Set(names).size,findings};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const report=await checkPublicTree();
  // Report locations and categories only; never echo matched private values.
  console.log(JSON.stringify(report,null,2));
  if(report.findings.length)process.exitCode=1;
}
