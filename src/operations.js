import { z } from 'zod/v4';
import { ZspaceError, usage } from './errors.js';
import { READ_APIS, readApi, status } from './catalog.js';
import * as files from './files.js';
import { inventory, appInfo, appAction, appInstall, appUninstall, coverage } from './applications.js';
import { android, ANDROID_APPS } from './android.js';

// Every CLI operation and MCP tool below uses this same schema and implementation.
// Paths are fixed; callers cannot override hosts, cookies, HTTP headers or methods.
export const OPERATIONS = new Map();
const str = z.string().min(1).max(8192);
const text = z.string().max(1048576);
const id = z.union([z.string().min(1).max(512), z.number().int().nonnegative()]);
const num = z.number().int().nonnegative();
const bit = z.union([z.literal(0), z.literal(1)]);
const path = str.refine(v => { try { files.nasPath(v); return true; } catch { return false; } }, '需要 NAS 绝对路径');
const ids = z.array(id).min(1).max(1000);
const paths = z.array(path).min(1).max(1000);
const page = { start: num.default(0), num: num.min(1).max(1000).default(100) };
const location = z.union([z.literal(1), z.literal(2)]).default(2).describe('2 普通记事本；1 保险箱内记事本');
const note = { location };
const noteLabel = z.number().int().min(0).max(5).describe('0 红、1 橙、2 黄、3 绿、4 蓝、5 紫');
function add(name, endpoint, description, shape = {}, options = {}) {
  if (OPERATIONS.has(name)) throw new Error(`Duplicate operation ${name}`);
  const op = { name, domain: name.split('.')[0], endpoint, description, schema: z.strictObject(shape), method: 'POST', encoding: 'form', write: false, ...options };
  OPERATIONS.set(name, op);
  return op;
}
const get = (name, endpoint, description, shape = {}, options = {}) => add(name, endpoint, description, shape, { method: 'GET', ...options });
const write = (name, endpoint, description, shape, options = {}) => add(name, endpoint, description, shape, { write: true, ...options });
const json = { encoding: 'json' };
const packed = { encoding: 'packed' };
// Acceptance is tied to the protocol version and cases in the sanitized report,
// not a promise that every firmware, account or input combination is supported.
const appValidation = { basis:'web-client-contract', webVersion:'2.3.2026082801', liveVerified:true, report:'docs/acceptance-app-workflows-v0.5.json' };
const appRead = (name, endpoint, description, shape={}, options={}) => add(name,endpoint,description,shape,{validation:appValidation,...options});
const appGet = (name, endpoint, description, shape={}, options={}) => appRead(name,endpoint,description,shape,{method:'GET',...options});
const appWrite = (name, endpoint, description, shape, options={}) => appRead(name,endpoint,description,shape,{write:true,...options});

for (const [name, api] of Object.entries(READ_APIS)) add(name, api.endpoint, api.description, name==='files.tasks'?page:{}, { method: api.method || 'POST', run: (c,p) => readApi(c, name,p) });
add('system.status', null, '设备概况', {}, { run: c => status(c) });
add('files.roots', '/auth/token', '当前账号的个人空间根目录', {}, { run: async c => {
  const u = await c.request('/auth/token'); return (u.sp_perms || []).map(p => ({ pool: p.pool, permission: p.perm, path: `/${p.pool}/my/data` }));
} });
add('files.list', '/v2/file/list', '列出文件，可按页或遍历所有页', { path, start: num.default(0), limit: num.min(1).max(1000).default(100), all: z.boolean().default(false), hidden: z.boolean().default(false), sort: z.enum(['name','mtime','ctime','size','type']).default('name'), order: z.enum(['asc','desc']).default('asc') }, { run: (c,p) => files.listFiles(c,p.path,p) });
add('files.info', '/v2/file/info', '文件元数据', { path }, { run: (c,p) => files.fileInfo(c,p.path) });
write('files.mkdir', '/v2/file/newdir', '新建目录，拒绝覆盖', { path }, { run: (c,p) => files.mkdirRemote(c,p.path) });
write('files.rename', '/v2/file/modify', '文件或目录改名，拒绝覆盖', { path, name:str }, { run: (c,p) => files.renameRemote(c,p.path,p.name) });
for (const mode of ['copy','move']) write(`files.${mode}`, `/v2/file/${mode}`, mode === 'copy' ? '复制文件或目录' : '移动文件或目录', { paths, to:path, wait: z.boolean().default(true), wait_ms:num.min(1).max(3600000).default(30000) }, { run: (c,p) => files.transferRemote(c,p.paths,p.to,mode,{wait:p.wait,waitMs:p.wait_ms}) });
write('files.trash', '/v2/file/remove', '移入回收站，校验回收站保留策略', { paths, wait:z.boolean().default(true), wait_ms:num.min(1).max(3600000).default(30000) }, { run: (c,p) => files.trashRemote(c,p.paths,{wait:p.wait,waitMs:p.wait_ms}) });
add('files.recycle', '/v2/file/nb/list', '个人回收站列表', { start:num.default(0),limit:num.min(1).max(1000).default(100) }, { run: (c,p) => files.listTrash(c,p) });
add('files.task', '/v2/file/taskbyids', '文件任务状态', { id }, { run: (c,p) => files.taskInfo(c,p.id) });
write('files.upload', '/v2/file/create', '上传本机文件到 NAS，拒绝覆盖', { local:str, remote:path }, { run:(c,p)=>files.upload(c,p.local,p.remote) });
add('files.download', '/v2/file/download', '下载 NAS 文件到本机，拒绝覆盖并返回 SHA-256', { remote:path, local:str }, { localWrite: true, run:(c,p)=>files.download(c,p.remote,p.local) });
add('files.recent', '/v2/file/latest/list', '最近文件', page);
add('files.download-tasks', '/v2/file/dwlist', '文件传输列表');

add('notes.list','/v2/file/notepad/list','笔记列表',{...note,...page,classify_id:z.number().int().min(-1).default(0),label_id:noteLabel.optional(),sortby:z.number().int().min(1).max(6).optional().describe('1/2 修改时间降/升序；3/4 创建时间降/升序；5/6 标题降/升序')});
add('notes.info','/v2/file/notepad/info','读取笔记正文',{...note,id});
add('notes.search','/v2/file/notepad/searchnotepad','搜索笔记',{...note,...page,keyword:str});
add('notes.categories','/v2/file/notepad/allclassify','笔记分类树',note);
add('notes.config','/v2/file/notepad/getconfig','记事本配置',note);
add('notes.usage','/v2/file/notepad/totalsize','笔记空间占用',note);
add('notes.history','/v2/file/notepad/historylist','笔记修订历史',{...note,id,...page});
add('notes.history-info','/v2/file/notepad/historyinfo','笔记修订内容',{...note,id});
write('notes.create','/v2/file/notepad/new','新建笔记',{...note,title:str,body:text.default(''),classify_id:num.default(0),note_type:z.union([z.literal(0),z.literal(2)]).default(2)});
write('notes.update','/v2/file/notepad/modify','更新笔记',{...note,id,title:str,body:text,in_brief:text.optional()});
write('notes.delete','/v2/file/notepad/delete','删除指定笔记',{...note,ids});
write('notes.category-create','/v2/file/notepad/newclassify','创建笔记分类',{...note,name:str,parent_id:num.default(0)});
write('notes.category-rename','/v2/file/notepad/updateclassify','重命名笔记分类',{...note,id,name:str,parent_id:num.default(0)});
write('notes.category-delete','/v2/file/notepad/deleteclassify','删除笔记分类',{...note,id});
write('notes.pin','/v2/file/notepad/pin','置顶笔记；cancel=1 取消置顶',{...note,id,cancel:bit.default(0)});
appRead('notes.category-list','/v2/file/notepad/classifylist','分页读取笔记分类',{...note,...page});
appWrite('notes.move','/v2/file/notepad/movenotepad','批量移动笔记到分类；classify_id=0 移出分类',{...note,ids,classify_id:num});
appWrite('notes.label','/v2/file/notepad/updatelabel','设置或取消笔记颜色标签；action=1 设置、2 取消',{...note,id,label_id:noteLabel,action:z.union([z.literal(1),z.literal(2)]).default(1)});

add('photos.albums','/v2/album/albums','相册列表',page);
add('photos.home','/v2/album/home','相册首页');
add('photos.directories','/v2/album/dirs','已索引的照片目录');
add('photos.album','/v2/album/album/info','相册详情',{album_id:id});
add('photos.items','/v2/album/album/feeds','相册照片列表',{album_id:id,...page});
add('photos.timeline','/v2/album/feed/timeline','照片时间线',page);
add('photos.config','/v2/album/conf/load','相册配置');
add('photos.scan','/v2/album/flush/info','相册索引进度');
add('photos.ai-status','/v2/album/ai/state','照片 AI 状态');
add('photos.ai-tasks','/v2/album/ai/taskManager','照片 AI 任务');
add('photos.ai-events','/v2/album/ai/taskEventList','照片 AI 事件',page);
add('photos.shares','/v2/album/share/list','相册分享列表',page);
add('photos.database','/v2/album/db/size','相册数据库占用');
write('photos.album-create','/v2/album/album/create','新建相册',{name:str,type:z.literal(10).default(10)});
write('photos.album-rename','/v2/album/album/modify','修改相册名称',{album_id:id,name:str});
write('photos.album-delete','/v2/album/album/delete','删除相册',{album_id:id});
write('photos.album-add','/v2/album/album/feed/add','添加已有照片到相册',{album_id:id,feed_ids:ids},{run:(c,p)=>c.request('/v2/album/album/feed/add',{data:{...p,feed_ids:p.feed_ids.join(',')}})});
appRead('photos.by-path','/v2/album/feed/bypath','按 NAS 文件路径读取已索引照片',{paths});
appRead('photos.photo-albums','/v2/album/album/albums/by_feed_id','查看照片所属相册',{feed_id:id});
appRead('photos.favorites','/v2/album/ilike/list','分页读取收藏照片',page,{run:(c,p)=>c.request('/v2/album/ilike/list',{data:{...p,liked:1}})});
appWrite('photos.favorite','/v2/album/feed/like','收藏照片或取消收藏；liked=1 收藏、0 取消',{feed_id:id,liked:bit});
const photoIds = z.array(id.refine(v=>!/[\r\n,]/.test(String(v)),'照片 ID 不能包含逗号或换行')).min(1).max(1000);
appWrite('photos.album-remove','/v2/album/album/feed/delete','从普通相册移除照片；不调用源文件删除接口',{album_id:id,feed_ids:photoIds},{run:(c,p)=>c.request('/v2/album/album/feed/delete',{data:{...p,feed_ids:p.feed_ids.join(','),confirm:1}})});
appWrite('photos.directory-add','/v2/album/dirs/add/no_flush','添加照片索引目录；使用 directory-scan 扫描新目录',{paths});
appWrite('photos.directory-remove','/v2/album/dirs/delete','移除照片索引目录引用；保留源文件',{dir_ids:photoIds},{run:(c,p)=>c.request('/v2/album/dirs/delete',{data:{dir_ids:p.dir_ids.join(',')}})});
appWrite('photos.directory-scan','/v2/album/dirs/flush','扫描指定照片索引目录；随后查询 photos.scan',{dir_ids:photoIds},{run:(c,p)=>c.request('/v2/album/dirs/flush',{data:{dir_ids:p.dir_ids.join(',')}})});

add('video.libraries','/zvideo/classification/list','影视库列表');
add('video.directories','/zvideo/classification/dirs','影视库目录');
add('video.latest','/zvideo/home/collection/latest','最新入库影视',page);
add('video.suggested','/zvideo/home/collection/suggested','推荐影视',page);
add('video.recent','/zvideo/video/v2/lately','最近播放',page);
add('video.playlists','/zvideo/video/v2/playlist','播放列表',page);
add('video.favorites','/zvideo/favorite/list','影视收藏',page);
add('video.filters','/zvideo/collection/filter/v2','影视筛选条件');
add('video.collection','/zvideo/collection/info','影视条目详情',{collection_id:id,classification_id:id});
add('video.shares','/zvideo/share/v4/list','影视分享列表',page);
add('video.config','/zvideo/settings/load','影视设置',{key:str.default('skip')});
add('video.scan-schedule','/zvideo/task/cron/info','媒体扫描计划');
write('video.library-create','/zvideo/classification/add','添加影视库',{classification_name:str,file_path:path,not_scrape:bit.default(1)});
write('video.library-rename','/zvideo/classification/editname','重命名影视库',{classification_id:id,new_name:str});
write('video.library-delete','/zvideo/classification/del','移除影视库',{classification_id:id});
write('video.rescan','/zvideo/classification/rescan','重新扫描指定影视库',{classification_id:id});
write('video.seen','/zvideo/collection/seen/add','标记影视已看',{collection_id:id});
write('video.unseen','/zvideo/collection/seen/delete','取消影视已看标记',{collection_id:id});
appWrite('video.favorite-add','/zvideo/favorite/add','收藏指定影视条目',{collection_id:id,classification_id:id});
appWrite('video.favorite-remove','/zvideo/favorite/delete','取消指定影视条目收藏',{collection_id:id,classification_id:id});
appRead('video.collections','/zvideo/video/v2/list','分页读取指定影视库条目；start 从 1 开始',{classification_id:id,start:num.min(1).default(1),limit:num.min(1).max(1000).default(100)},{run:(c,p)=>c.request('/zvideo/video/v2/list',{data:{...p,system:0,field:'release_year',sort:'desc',seen:0,collection_type:0}})});
appWrite('video.collection-create','/zvideo/collection/add','在普通影视库创建自定义合集；不刮削库不支持',{classification_id:id,title:str,storyline:text.default('')},{run:(c,p)=>c.request('/zvideo/collection/add',{data:{...p,cover:''}})});
appWrite('video.collection-dismiss','/zvideo/collection/dismiss','解散自定义影视合集，保留源文件',{classification_id:id,collection_id:id});

const musicPage = { page:num.min(1).default(1),page_size:num.min(1).max(500).default(50) };
add('music.songs','/zmusic/api/v2/song/list','音乐库曲目',{...musicPage,filter_type:str.optional(),filter_value:str.optional(),sort_field:str.optional(),order:z.enum(['asc','desc']).default('asc')});
get('music.overview','/zmusic/api/v2/song/overview','音乐库概况');
get('music.latest','/zmusic/api/v2/song/latest','最新音乐',page);
get('music.playlists','/zmusic/api/v2/playlist/list','歌单列表',page);
get('music.playlist','/zmusic/api/v2/playlist/info','歌单详情',{playlist_id:id});
get('music.playlist-songs','/zmusic/api/v2/playlist/record/list','歌单曲目',{playlist_id:id,...musicPage});
get('music.artists','/zmusic/api/v2/artist/list','歌手列表',page);
get('music.albums','/zmusic/api/v2/album/list','音乐专辑',page);
get('music.album','/zmusic/api/v2/album/info','专辑详情',{id});
get('music.genres','/zmusic/api/v2/genre/list','曲风列表');
get('music.favorites','/zmusic/api/v2/favorite/list','音乐收藏');
get('music.recent','/zmusic/api/v2/history/song','最近播放的音乐',page);
get('music.status','/zmusic/api/v2/services/status','音乐服务状态');
get('music.config','/zmusic/api/v2/setting/load','音乐设置');
write('music.playlist-create','/zmusic/api/v2/playlist/add','创建歌单',{playlist_name:str});
write('music.playlist-update','/zmusic/api/v2/playlist/update','更新歌单',{playlist_id:id,playlist_name:str});
write('music.playlist-delete','/zmusic/api/v2/playlist/delete','删除歌单',{playlist_id:ids});
write('music.playlist-add','/zmusic/api/v2/playlist/record/add','添加曲目到歌单',{playlist_id:id,add_type:z.enum(['song','album','artist','folder']),add_value:ids});
write('music.playlist-remove','/zmusic/api/v2/playlist/record/remove','从歌单移除曲目',{playlist_id:id,remove_type:z.enum(['song','album','artist','folder']).default('song'),remove_value:ids});
appGet('music.song','/zmusic/api/v2/song/info','曲目详情与标签',{song_id:id});
appGet('music.lyrics','/zmusic/api/v2/song/info/lyrics','读取曲目歌词',{song_id:id});
appGet('music.cue','/zmusic/api/v2/song/info/cue','读取曲目 CUE 分轨信息',{song_id:id});
appWrite('music.lyrics-update','/zmusic/api/v2/song/info/lyrics','更新指定曲目的歌词',{song_id:id,song_lyrics:text});
const musicFavorite = {favorite_type:z.enum(['song','album','artist','playlist']),favorite_content:ids};
appWrite('music.favorite-add','/zmusic/api/v2/favorite/add','收藏曲目、专辑、歌手或歌单',musicFavorite);
appWrite('music.favorite-remove','/zmusic/api/v2/favorite/delete','取消曲目、专辑、歌手或歌单收藏',musicFavorite);
for (const [kind,action,label] of [['song','songs','曲目'],['album','albums','专辑'],['artist','artists','歌手'],['playlist','playlists','歌单']]) {
  const endpoint=`/zmusic/api/v2/favorite/${kind}/list`;
  appGet(`music.favorite-${action}`,endpoint,`分页读取收藏${label}`,musicPage,{run:(c,p)=>c.request(endpoint,{method:'GET',query:{...p,...(['song','playlist'].includes(kind)?{source:2}:{})}})});
}
appGet('music.tasks','/zmusic/api/v2/task/status','音乐库后台任务状态');
appGet('music.directories','/zmusic/api/v2/song/file','音乐库的来源文件与目录');
appWrite('music.library-add','/zmusic/api/v2/song/file/add','添加来源文件或目录到音乐库；随后查询 music.tasks',{file_path:paths});
appWrite('music.library-remove','/zmusic/api/v2/song/remove','从音乐库移除来源路径引用；保留源文件',{file_path:paths},{run:(c,p)=>c.request('/zmusic/api/v2/song/remove',{data:{remove_type:'file',remove_value:p.file_path}})});
appWrite('music.library-rescan','/zmusic/api/v2/song/file/refresh','重新扫描指定音乐来源路径；随后查询 music.tasks',{file_path:paths});

get('audiobooks.libraries','/zaudio/api/v1/playlist/all','有声读物书库');
get('audiobooks.library','/zaudio/api/v1/playlist','有声书库详情',{playlist_id:id});
get('audiobooks.chapters','/zaudio/api/v1/playlist/record/list','有声书章节',{playlist_id:id,...musicPage});
get('audiobooks.recent','/zaudio/api/v1/history/latest','最近收听',page);
get('audiobooks.scan-status','/zaudio/api/v1/task/refresh/status','有声书扫描状态',{playlist_id:id});
write('audiobooks.library-create','/zaudio/api/v1/playlist/add','创建有声书库',{playlist_name:str});
write('audiobooks.library-rename','/zaudio/api/v1/playlist/edit','重命名有声书库',{playlist_id:id,playlist_name:str});
write('audiobooks.library-delete','/zaudio/api/v1/playlist/delete','删除有声书库',{playlist_id:id});
appWrite('audiobooks.directory-add','/zaudio/api/v1/playlist/dir/add','添加 NAS 目录到有声书库；随后查询 import-status',{playlist_id:id,dirs:paths});
appWrite('audiobooks.directory-remove','/zaudio/api/v1/playlist/dir/delete','从有声书库移除目录引用',{playlist_id:id,dirs:paths});
appWrite('audiobooks.chapter-remove','/zaudio/api/v1/playlist/record/delete','从有声书库移除指定章节',{playlist_id:id,track_id:ids});
appWrite('audiobooks.rescan','/zaudio/api/v1/task/refresh','重新扫描指定有声书库；随后查询 scan-status',{playlist_id:id});
appGet('audiobooks.import-status','/zaudio/api/v1/task/status/add','有声书目录导入进度',{playlist_id:id});
appGet('audiobooks.external-status','/zaudio/api/v1/playlist/extdev/status','有声书库外部存储可用状态',{playlist_id:id});
appGet('audiobooks.chapter-position','/zaudio/api/v1/playlist/record/position','查询章节在书库排序中的位置',{playlist_id:id,track_id:id,order:z.enum(['asc','desc']).default('asc'),sort_filed:z.literal('title').default('title')});

add('downloads.list','/downloader/list','下载任务',{...page,status:str.optional()});
add('downloads.settings','/downloader/get/setting','下载设置');
add('downloads.protocols','/downloader/get/protocols','支持的下载协议');
add('downloads.directories','/downloader/downloaddir','下载保存目录');
add('downloads.engine','/downloader/engin/switch/status','下载引擎状态');
add('downloads.details','/downloader/tasks/details','下载队列和任务统计');
add('downloads.share-list','/downloader/share/list','分享下载任务',page);
write('downloads.add','/downloader/add/link','添加 HTTP、FTP 或 magnet 下载链接',{uri:str,dir:path});
write('downloads.start','/downloader/start','继续下载任务',{id});
write('downloads.stop','/downloader/stop','暂停下载任务',{id});
write('downloads.remove','/downloader/del','移除下载任务（默认保留文件）',{id,remove:bit.default(0)});

get('docker.containers','/zdocker/container_list','所有容器');
get('docker.inspect','/zdocker/container_info','容器详情',{container_id:str});
get('docker.stats','/zdocker/container_stats','容器资源使用',{container_id:str.optional()});
get('docker.logs','/zdocker/container_logs','容器日志',{container_id:str,tail:num.max(1000).default(100)});
get('docker.top','/zdocker/container_top','容器内进程',{container_id:str});
get('docker.images','/zdocker/local_image_list','本地镜像');
get('docker.image','/zdocker/image_info','镜像详情',{image_id:str});
get('docker.networks','/zdocker/network_list','Docker 网络');
get('docker.network','/zdocker/network_info','Docker 网络详情',{network_id:str});
get('docker.status','/zdocker/system_status','Docker 服务状态');
get('docker.info','/zdocker/system_info','Docker 系统信息');
get('docker.storage','/zdocker/storagepool_get_datadirconf','Docker 数据目录');
get('docker.pull-tasks','/zdocker/image_pull_task_list','镜像拉取任务');
write('docker.action','/zdocker/container_op','启动、停止、重启或暂停指定容器',{container_id:str,action:z.enum(['start','stop','restart','pause','unpause'])},{method:'GET'});
const containerSpec=z.object({Image:str,Env:z.array(z.string()).optional(),Cmd:z.array(z.string()).optional(),HostConfig:z.record(z.string(),z.json()).optional()}).catchall(z.json());
write('docker.create','/zdocker/container_create','创建容器；config 为 Docker 容器 JSON 配置，不自动启动',{name:str,config:containerSpec},{run:(c,p)=>c.request('/zdocker/container_create',{query:{name:p.name},body:JSON.stringify(p.config),headers:{'Content-Type':'application/json'}})});
write('docker.update','/zdocker/container_update','更新容器配置',{container_id:str,name:str,config:containerSpec},{run:(c,p)=>c.request('/zdocker/container_update',{query:{container_id:p.container_id,name:p.name},body:JSON.stringify(p.config),headers:{'Content-Type':'application/json'}})});
write('docker.remove','/zdocker/container_op','删除指定容器',{container_id:str},{method:'GET',run:(c,p)=>c.request('/zdocker/container_op',{method:'GET',query:{...p,action:'remove'}})});
write('docker.pull','/zdocker/image_pull','拉取指定镜像',{image_name:str},{method:'GET'});
write('docker.image-remove','/zdocker/image_remove','删除指定镜像',{image_id:str},{method:'GET'});
write('docker.network-create','/zdocker/network_create','创建 Docker 网络',{Name:str,Driver:z.enum(['bridge','macvlan','ipvlan']).default('bridge'),Internal:z.boolean().default(false),EnableIPv6:z.boolean().default(false),IPAM:z.record(z.string(),z.json()).optional(),Options:z.record(z.string(),z.string()).optional()},json);
write('docker.network-remove','/zdocker/network_remove','删除 Docker 网络',{network_id:str},{method:'GET'});
add('compose.list','/zdocker/v2/compose/list_projects','Compose 项目',{},json);
get('compose.containers','/zdocker/v2/compose/list_project_containers','项目容器',{project_id:id});
get('compose.file','/zdocker/v2/compose/get_project_file','读取 Compose 配置（凭证会被隐藏）',{project_id:id});
get('compose.tasks','/zdocker/v2/compose/task_list','Compose 任务');
get('compose.logs','/zdocker/v2/compose/logs_project','项目日志',{project_id:id,tail:num.max(1000).default(100)});
for (const action of ['start','stop','restart']) write(`compose.${action}`,`/zdocker/compose_${action}_project`,`Compose ${action}`,{project_id:id},{method:'GET'});
write('compose.create','/zdocker/v2/compose/create_project','保存 Compose 项目；默认不启动',{name:str,path,config:text,start:bit.default(0),rw:bit.default(0),env:text.optional()});

add('vm.list','/v1/vm/domain/domainList','虚拟机列表');
add('vm.host','/v1/vm/domain/getPhyHostStatus','虚拟机宿主机状态');
add('vm.service','/v1/vm/domain/serviceCheck','虚拟机服务状态');
add('vm.inspect','/v1/vm/domain/domainDetail','虚拟机详情',{name:str});
add('vm.disks','/v1/vm/domain/sdaList','虚拟机磁盘',{name:str});
add('vm.snapshots','/v1/vm/domain/snapshotList','虚拟机快照',{name:str});
add('vm.network','/v1/vm/domain/getnetworkconfig','虚拟机网络配置',{name:str});
get('vm.pci','/v1/vm/domain/pci/list','PCI 设备');
get('vm.schedules','/v1/vm/domain/timerjob/list','虚拟机定时计划',{name:str});
write('vm.action','/v1/vm/domain/domainSetStatus','虚拟机电源控制',{name:str,status:z.enum(['start','shutdown','reboot','suspend','resume'])});

get('antivirus.status','/v1/zvirusscan/info','病毒查杀状态');
get('antivirus.database','/v1/zvirusscan/database/clamavinfo','病毒库版本');
get('antivirus.whitelist','/v1/zvirusscan/whitelist/list','查杀白名单');
get('antivirus.quarantine','/v1/zvirusscan/quarantine/detail','隔离区概况');
get('antivirus.usage','/v1/zvirusscan/datause/info','查杀空间占用');
get('antivirus.schedule','/v1/zvirusscan/autoscan/info','自动查杀计划');
write('antivirus.update','/v1/zvirusscan/database/update','更新病毒库',{}, {method:'GET'});

add('camera.list','/AppStore/znvr/v1/camera/manage/list','摄像头列表',{cam_uuid:str.default('all')},packed);
add('camera.config','/AppStore/znvr/v1/camera/config','摄像头设置',{cam_uuid:str},packed);
add('camera.storage','/AppStore/znvr/v1/camera/db/config/list','监控存储配置',{},packed);
get('ddns.list','/zddns/v1/ddns/list','DDNS 记录');
add('wechat.directory','/AppStore/wxrobot/config/dirinfo','微信快存保存目录');
add('wechat.config','/AppStore/wxrobot/config/all','微信快存设置');
add('wechat.accounts','/AppStore/wxrobot/weixin/bindlist','微信快存绑定列表');
add('wechat.messages','/AppStore/wxrobot/chat/list','已快存的微信消息',page);
add('ai.models','/AiLab/v1/models','NAS 本地 AI 模型');
add('ai.status','/AiLab/v1/llama/state','本地 AI 推理服务状态');
add('ai.downloads','/AiLab/v1/model/download/state','本地模型下载进度');
add('ai.disks','/AiLab/v1/disks','AI 模型存储目录');
add('images.engine','/converter/v1/engine/check','影像处理引擎');
add('images.downloads','/converter/v1/download/info','影像处理引擎下载状态');

add('backup.tasks','/zbakv2/task/list','备份中心任务',page);
add('backup.info','/zbakv2/task/info','备份任务详情',{task_id:id});
add('backup.failures','/zbakv2/task/failist','备份失败记录',{task_id:id,...page});
add('backup.usb-tasks','/zbakv2/plugin/v2/task/list','即插即备任务',page);
add('backup.usb-config','/zbakv2/plugin/setting/info','即插即备设置');
write('backup.start','/zbakv2/task/taskstart','立即运行指定备份任务',{task_id:id});
get('sync.status','/docsync/info','文档同步状态');
add('office.status','/AppCenter/OnlyOffice/v1/service/state','文档编辑服务状态');
add('office.config','/v2/weboffic/getconfig','Office 配置');
add('office.fonts','/v2/onlyoffice/font/list','Office 字体');
add('vault.status','/v2/file/safe/status','保险箱状态');
add('vault.download-status','/v2/file/safe/dwstatus','保险箱传输状态');
write('vault.lock','/v2/file/safe/close','锁定保险箱',{});
add('collections.list','/v2/receiver/list','文件收集任务',page);
add('collections.info','/v2/receiver/info','文件收集任务详情',{id});
add('collections.files','/v2/receiver/files','已收集文件',{id,...page});
add('search.files','/file_search/file_search','按关键词搜索文件',{keyword:str,...page});
add('search.documents','/file_search/office_search','文档全文搜索',{keyword:str,...page});
add('search.config','/file_search/get_setting','搜索索引设置');
add('search.exclusions','/file_search/skip_dir/list','搜索排除目录');
add('search.index-status','/file_search/check_reindex','搜索索引状态');
add('classes.courses','/zedu/course/list','极课堂课程',page);
add('classes.course','/zedu/course/info','课程详情',{course_id:id});
add('classes.resources','/zedu/resource/list','课程资源',{course_id:id,...page});
add('classes.recent','/zedu/feeds/last','指定课程最近学习',{course_id:id,...page});
add('recovery.disks','/AppStore/filerescue/list','恢复助手可用磁盘');
add('sharing.links','/v2/share/list','外链分享记录',page);
add('sharing.statistics','/v2/share/statics','分享统计');
add('sharing.internal','/v2/nshare/list','内部分享',page);
add('sharing.received','/v2/nshare/forme','分享给我的文件',page);
add('sharing.sent','/v2/nshare/mine','我的内部分享',page);
add('team.groups','/v2/public/group/list','团队分组',{path});
add('team.permissions','/v2/public/permission/list','团队空间权限',{path});
add('team.quota','/v2/public/quota/list','团队配额',{path});
add('users.list','/auth/user/list','NAS 账号列表');
add('security.firewall','/v1/zfirewall/services','防火墙服务',{}, {method:'GET'});
add('security.access','/ip_access/control_list','IP 访问控制列表',page);
add('settings.load','/setting/load','系统配置（凭证字段隐藏）');
add('settings.ssh','/setting/sshd/status','SSH 服务状态');
add('storage.external','/zspool/external/list','外接存储设备');
add('storage.smart','/zspool/smart/report2','磁盘 SMART 报告',{disk_id:str});
add('storage.snapshots','/zspool/snapshot/list','存储快照',{pool_id:id});
add('storage.migration','/zspool/hddmove/emove/status','硬盘搬家状态');
for(const service of ['samba','webdav','ftp','dlna']) add(`services.${service}`,`/api/fileshare_service/${service}/status`,`${service} 服务状态`);
add('services.tm','/api/fileshare_service/tm/status','Time Machine 状态',{}, {run:c=>c.request('/api/fileshare_service/tm/status',{data:{type:7,data:JSON.stringify({username:decodeURIComponent(c.cookies.username||'')})}})});
get('ftp-backup.status','/ftprsync/checklogin','FTP 备份连接状态');
get('ftp-backup.tasks','/ftprsync/download/list','FTP 备份任务',page);
get('hdmi.status','/hdmiapi/getlogin','HDMI 登录状态');
get('hdmi.fonts','/hdmiapi/getfontlist','HDMI 字体');
get('remote.support','/zhelper/state','远程协助状态');
get('thunder.status','/thunder/getWebUrl','迅雷绑定状态（不输出第三方登录 URL）',{}, {run:async c=>{const x=await c.request('/thunder/getWebUrl',{method:'GET'});return {bound:x.bind_result,attempts:x.bind_try,hasWebEntry:Boolean(x.weburl)};}});
get('hsk.status','/hsk/device.json','花生壳嵌入服务状态（不输出设备密钥）',{}, {run:async c=>{const r=await c.response('/hsk/device.json',{method:'GET'});const x=await r.json();return {success:x.success,hasDevice:Boolean(x.getsn),servicePort:x.serviceport};}});
add('apps.inventory',null,'合并原生应用与 Docker 应用的安装清单',{installed:z.boolean().default(false)},{run:inventory});
add('apps.info',null,'指定应用的安装状态与能力',{app:str},{run:(c,p)=>appInfo(c,p.app)});
add('apps.coverage',null,'每个已安装应用的 CLI/MCP 覆盖情况',{}, {run:c=>coverage(c,[...OPERATIONS.values()])});
add('apps.tasks','/AppStore/v1/pkg/tasks','应用安装更新任务');
add('apps.docker-tasks','/zdocker/AppStore/v1/pkg/tasks','Docker 应用安装更新任务');
write('apps.action',null,'启动、停止或重启支持启停的应用',{app:str,action:z.enum(['start','stop','restart'])},{run:appAction});
write('apps.install',null,'安装或升级原生应用；mp 为应用存储挂载点',{app:str,mp:path},{run:appInstall});
write('apps.uninstall',null,'卸载允许移除的应用，默认保留数据',{app:str,with_data:bit.default(0)},{run:appUninstall});

// Provider names and path templates are fixed; this never proxies to an arbitrary host.
const clouds = { baidu:'/znetdisk',aliyun:'/zdrive/adrive',yun115:'/zdrive/yun115',yun123:'/zdrive/yun123',quark:'/zdrive/kuake',google:'/zdrive/gdrive',dropbox:'/zdrive/dropbox',onedrive:'/zonedrive',tianyi:'/ztianyiclub',mobile:'/zdrive/yun139' };
const provider = z.enum(Object.keys(clouds));
for (const [action,suffix,desc] of [['status','auth/check','网盘授权状态'],['tasks','task/list','网盘传输任务'],['syncs','sync/list','网盘同步计划']]) add(`cloud.${action}`,null,desc,{provider,...(action==='status'?{}:page)}, {run:(c,p)=>{const {provider,...data}=p;if(provider==='dropbox'&&action!=='status'||provider==='mobile'&&action==='syncs')throw new ZspaceError('UNSUPPORTED','当前客户端未提供此网盘的该接口。');return c.request(clouds[provider]+'/'+suffix,{data});}});

const serial=z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/).optional();
const target=z.string().regex(/^[a-f0-9]{24}$/).describe('从最近一次 android.screen 返回的控件 target');
const adb={requiresNas:false,transport:'android-ui',method:null,encoding:null};
add('android.apps',null,'可通过手机桥接打开的应用入口',{}, {...adb,run:async()=>ANDROID_APPS});
for(const [action,description,shape,mutates] of [
  ['status','检查已连接的手机、极空间版本和前台状态',{},false],
  ['screen','读取极空间当前可见控件；隐藏密码和其他 App',{ },false],
  ['open','通过已登录手机打开指定应用；仅导航，不配置 NAS',{app:z.enum(Object.keys(ANDROID_APPS))},true],
  ['tap','点击当前界面的指定控件；可能修改手机或 NAS 数据',{target},true],
  ['set-text','向指定编辑框填入文本；不自动提交',{target,text:z.string().max(4000)},true],
  ['scroll','滚动极空间当前界面',{target:target.optional(),direction:z.enum(['up','down'])},true],
  ['back','返回极空间上一级界面，拒绝从首页退出',{},true],
])add('android.'+action,null,description,{serial,...shape},{...adb,write:mutates,localWrite:mutates,run:(_,p)=>android(action,p)});

export function operation(name) {
  const op = OPERATIONS.get(name);
  if (!op) throw usage(`未知操作 ${name}，使用 zspace api list 或 zspace commands 查看。`);
  return op;
}
export function parameters(op, input = {}) {
  const result = op.schema.safeParse(input);
  if (!result.success) throw usage(result.error.issues.map(i => `${i.path.join('.') || 'params'}: ${i.message}`).join('; '));
  return result.data;
}
export function operationInfo(op) {
  return { name:op.name, description:op.description, write:op.write, localWrite:Boolean(op.localWrite), experimental:Boolean(op.experimental), transport:op.transport||'nas-http',requiresNas:op.requiresNas!==false, method:op.method, endpoint:op.endpoint, encoding:op.encoding, ...(op.validation?{validation:op.validation}:{}), inputSchema:z.toJSONSchema(op.schema,{unrepresentable:'any'}) };
}
export async function runOperation(client, name, input = {}, { allowWrite = false, dryRun = false } = {}) {
  const op = operation(name); const p = parameters(op,input);
  if (dryRun) return { dryRun:true, operation:name, write:op.write, localWrite:Boolean(op.localWrite), requiresConfirmation:Boolean(op.write||op.localWrite), transport:op.transport||'nas-http', method:op.method, endpoint:op.endpoint, parameters:p, ...(op.validation?{validation:op.validation}:{}) };
  if ((op.write || op.localWrite) && !allowWrite) throw new ZspaceError('WRITE_DISABLED','此操作会修改 NAS、手机界面或本机文件；CLI 需要 --yes，MCP 需要启动时 --allow-write 且调用时 confirm=true。',{exitCode:2});
  if (op.run) return op.run(client,p);
  let options = { method:op.method };
  if (op.method === 'GET') options.query=p;
  else if (op.encoding === 'json') Object.assign(options,{body:JSON.stringify(p),headers:{'Content-Type':'application/json'}});
  else options.data=op.encoding==='packed'?{data:JSON.stringify(p)}:p;
  return client.request(op.endpoint,options);
}
