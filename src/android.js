import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ZspaceError } from './errors.js';

export const ANDROID_APPS = {
  home:'极空间首页',bookLib:'极阅读',comics:'极漫画',family:'亲情设置',mobileBackup:'手机备份',
};
const script=fileURLToPath(new URL('./android_bridge.py',import.meta.url));

export function pythonRequest(request, { execute=execFile, python=process.env.ZSPACE_ANDROID_PYTHON||'python3' }={}) {
  return new Promise((resolve,reject)=>{
    const child=execute(python,[script],{timeout:45000,maxBuffer:2*1024*1024,windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}},(error,stdout)=>{
      if(error){reject(new ZspaceError(error.killed?'ANDROID_TIMEOUT':'ANDROID_RUNTIME',error.killed?'安卓操作超时，先读取当前界面确认结果，不要自动重复提交。':'无法启动安卓桥接；需要 Python 3、adb 和 uiautomator2。',{exitCode:4}));return;}
      let result;try{result=JSON.parse(stdout);}catch{reject(new ZspaceError('ANDROID_PROTOCOL','安卓桥接没有返回有效 JSON。'));return;}
      if(!result.ok){reject(new ZspaceError(result.error?.code||'ANDROID_ERROR',result.error?.message||'安卓操作失败。'));return;}
      resolve(result.result);
    });
    // Do not put typed text in process arguments or use a shell.
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(request));
  });
}
export async function android(action,params={}, {runner=pythonRequest}={}) {
  return runner({...params,action});
}
