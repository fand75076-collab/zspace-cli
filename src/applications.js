import { usage, ZspaceError } from './errors.js';

// Application IDs come from AppStore, domains from the reviewed operation registry.
// An entry URL is navigation metadata, never an authenticated request to another host.
export const APPLICATIONS = {
  fileManage: ['个人空间',['files'],'/home/fileManage/'],
  public: ['团队空间',['files','team'],'/home/publicManage/'],
  photoAlbum: ['极相册',['photos'],'/home/album/'],
  video: ['极影视',['video'],'/home/video/'],
  music: ['极音乐',['music'],'/home/music/'],
  notebook: ['记事本',['notes'],'/home/notebook/'],
  safeBox: ['保险箱',['vault'],'/home/safebox/','解锁需要独立密码；不从浏览器提取或绕过保险箱密码'],
  downloads: ['下载',['downloads'],'/home/download/'],
  thunder: ['迅雷',['thunder'],null,'迅雷账号及内部下载操作使用独立认证'],
  cloudBackUp: ['网盘备份',['cloud'],'/home/newNetdisk/','未授权的网盘需要先在网页完成授权'],
  monitor: ['设备监控',['system'],'/home/monitor/'],
  recycle: ['回收站',['files'],'/home/recycle/'],
  settings: ['系统设置',['settings','services','system'],'/home/setting/'],
  saftyManage: ['安全管理',['security'],'/home/safe/'],
  users: ['用户中心',['users'],'/home/userCenter/'],
  FTPBackUp: ['FTP备份',['ftp-backup'],'/home/backupFtp/'],
  timeMachine: ['Mac备份',['services'],'/home/backupMac/'],
  flashTransfer: ['闪电传',['sharing'],'/home/fastShareCenter/','设备之间的实时传送需要对端在线'],
  data_migration: ['硬盘搬家',['storage'],'/home/switchDisk/','只接入状态；拆盘、格式化和迁移执行不做实机测试'],
  autoBackup: ['文档同步',['sync'],'/home/docSync/','电脑端同步代理的本机配置不属于 NAS HTTP API'],
  docker: ['Docker',['docker','compose'],'/home/docker/'],
  receiver: ['文件收集',['collections'],'/home/fileCollect/'],
  audioBooks: ['有声读物',['audiobooks'],'/home/music-audiobooks/'],
  bigsearch: ['高级搜索',['search'],'/home/bigSearch/'],
  search: ['搜索服务',['search'],'/home/bigSearch/'],
  backupCenter: ['备份中心',['backup'],'/home/backupCenterNew/index'],
  zclasses: ['极课堂',['classes'],'/home/classroom/'],
  remoteAccess: ['远程访问',['remote'],'/home/remoteAccess/nas'],
  virtualMachine: ['虚拟机',['vm'],'/home/virtualMachine/'],
  storage: ['存储管理',['storage'],'/home/storageManage/'],
  camera: ['监控中心',['camera'],'/home/camera/'],
  backupInsert: ['即插即备',['backup'],'/home/backupInsert/index'],
  ddns: ['DDNS',['ddns'],'/home/ddns/index'],
  hsk: ['花生壳',['hsk'],'/hsk/index.html','需要花生壳自身账号认证'],
  deepseek: ['DeepSeek',['ai'],'/home/deepSeek/'],
  onlyoffice: ['文档编辑',['office'],'/home/onlyoffice/','在线编辑器交互及文档渲染不等同于服务管理 API'],
  imgProcessing: ['影像处理',['images'],'/home/converter/'],
  zjdxb: ['节点小宝',[],'/zjdxb/index.html','需要节点小宝自身账号认证；没有接入其隧道业务接口'],
  zvirusscan: ['病毒查杀',['antivirus'],'/home/zvirusscan/'],
  fileSnap: ['文件快照',['storage'],'/home/fileSnap/'],
  wxrobot: ['微信快存',['wechat'],'/apphome_wxrobot/wxrobot/'],
  filerescue: ['恢复助手',['recovery'],'/apphome_filerescue/dataRecovery/'],
  HDMI: ['HDMI服务',['hdmi'],null,'HDMI 画面与输入由设备端处理'],
  ollama: ['Ollama',['docker','compose'],null,'应用生命周期已接入；模型服务需单独配置服务地址'],
  browser: ['浏览器',['docker','compose'],null,'应用生命周期已接入；网页交互使用应用本身'],
  bookLib: ['极阅读',['android'],null,'通过已登录安卓手机操作可见界面；尚无直连 NAS 书库 API'],
  comics: ['极漫画',['android'],null,'通过已登录安卓手机操作可见界面；尚无直连 NAS 漫画库 API'],
  family: ['亲情设置',['android'],null,'通过已登录安卓手机操作可见界面；账户变更须明确授权；尚无直连 NAS 业务 API'],
  mobileBackup: ['手机备份',['android'],null,'通过已登录安卓手机操作可见界面；备份任务未自动创建；NAS 普通文件可用 files 管理'],
  community: ['论坛',[],'https://www.zspace.cn/','外部网站，不是 NAS 本地应用 API'],
  helpCenter: ['帮助与反馈',[],'/home/helpCenter/','帮助页面及云端反馈；CLI 不自动发送反馈'],
  aiAssitant: ['AI助手',[],'/home/helpCenter?tab=chat','极空间云端客服助手；与本地 DeepSeek 模型是不同服务'],
  appstore: ['应用商店',['apps'],'/home/appStore/'],
};

export async function inventory(client, { installed = false } = {}) {
  const [native,docker] = await Promise.all([client.request('/AppStore/v1/list'),client.request('/zdocker/AppStore/v1/list')]);
  return [...(native.list||[]),...(docker.list||[])].filter(a=>!installed||Boolean(Number(a.installed))).map(a=>{
    const l=a.local_info||{};const language=(l.i18n||[]).find(i=>i.lang==='zh_cn');
    return { id:a.app_name,name:language?.name||APPLICATIONS[a.app_name]?.[0]||a.app_name,installed:Boolean(Number(a.installed)),state:a.status,version:l.version?.version||null,latest:a.latest_version?.version?.version||null,latestVersionInt:a.latest_version?.version?.version_int??null,docker:Boolean(Number(a.is_docker)),builtIn:Boolean(Number(a.is_buildin)),toggleable:Boolean(Number(a.toggleable)),removable:Boolean(Number(a.removable)),platforms:l.supports||[] };
  });
}
export async function appInstall(client,{app,mp}) {
  const a=await appInfo(client,app);
  if(a.docker)throw new ZspaceError('UNSUPPORTED','Docker 商店安装还需要专用配置，请通过应用商店安装，或使用 docker.create / compose.create。');
  if(!a.latestVersionInt)throw new ZspaceError('UNSUPPORTED','应用目录没有可安装的版本。');
  return client.request('/AppStore/v1/pkg/install',{data:{app_name:app,mp,version_int:a.latestVersionInt,isDocker:0}});
}
export async function appUninstall(client,{app,with_data=0}) {
  const a=await appInfo(client,app);
  if(!a.installed||!a.removable)throw new ZspaceError('APP_NOT_REMOVABLE','应用未安装或厂商不允许卸载。');
  return client.request(`${a.docker?'/zdocker':''}/AppStore/v1/pkg/uninstall`,{data:{app_name:app,with_data,isDocker:a.docker?1:0}});
}
export async function appInfo(client,id) {
  const a=(await inventory(client)).find(a=>a.id===id);
  if (!a) throw usage(`应用目录中没有 ${id}。`);
  return a;
}
export async function appAction(client,{app,action}) {
  const a=await appInfo(client,app);
  if (!a.installed) throw new ZspaceError('APP_NOT_INSTALLED','应用尚未安装。');
  if (!a.toggleable) throw new ZspaceError('APP_NOT_TOGGLEABLE','厂商未允许对该内置应用进行启停操作。');
  return client.request(`${a.docker?'/zdocker':''}/AppStore/v1/pkg/${action}`,{data:{app_name:app,isDocker:a.docker?1:0}});
}
export async function coverage(client,operations) {
  const apps=await inventory(client,{installed:true});
  return { installed:apps.length, applications:apps.map(a=>{
    const def=APPLICATIONS[a.id]; const domains=def?.[1]||[]; const ops=operations.filter(op=>domains.includes(op.domain));
    const statusOnly=new Set(['safeBox','monitor','data_migration','autoBackup','remoteAccess','ddns','deepseek','onlyoffice','imgProcessing','filerescue','HDMI','hsk','thunder','timeMachine','ollama','browser']);
    return { ...a,domains,operations:ops.map(op=>op.name),scope:!ops.length?'package-only':domains.includes('android')?'android-ui':statusOnly.has(a.id)?'status-or-service':'partial-business',limitation:def?.[3]||null,entry:def?.[2]?new URL(def[2],client.baseUrl).href:null,packageManagement:['info',...(a.toggleable?['start','stop','restart']:[]),...(!a.docker&&a.latestVersionInt?['install-or-upgrade']:[]),...(a.removable?['uninstall']:[])] };
  }) };
}
