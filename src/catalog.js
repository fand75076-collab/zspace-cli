// Read-only endpoints, checked against the live web UI on 2026-09-30.
export const READ_APIS = {
  'system.polling': { endpoint: '/system/polling2', description: '系统运行状态和固件版本' },
  'system.recent': { endpoint: '/system/recent', description: 'CPU、内存、网络和温度' },
  'system.versions': { endpoint: '/system/versions', description: '系统组件版本' },
  'system.usage': { endpoint: '/system/diskusage3', description: '磁盘空间用量' },
  'system.services': { endpoint: '/manager/services', description: '服务资源用量' },
  'system.processes': { endpoint: '/manager/v2/processes', description: '进程资源用量' },
  'system.network': { endpoint: '/network-settings/v1/interface/list', method: 'GET', description: '网络接口' },
  'storage.pools': { endpoint: '/zspool/info', description: '存储池和磁盘' },
  'storage.hardware': { endpoint: '/zspool/hardware/info', description: '硬盘槽位' },
  'storage.status': { endpoint: '/zspool/polling', description: '存储实时状态' },
  'storage.capabilities': { endpoint: '/zspool/capability', description: '存储能力' },
  'apps.list': { endpoint: '/AppStore/v1/list', description: '应用目录和安装状态' },
  'files.tasks': { endpoint: '/v2/file/tasks', description: '异步文件任务' },
  'files.categories': { endpoint: '/v2/file/categories', description: '文件类型统计' },
  'files.recycle-config': { endpoint: '/v2/file/recycle/config/get', description: '回收站保留周期' },
};
export async function readApi(client, name, params = {}) {
  if(name==='apps.list') {
    const { inventory } = await import('./applications.js');
    const list=await inventory(client); return {total:list.length,list};
  }
  const api = READ_APIS[name];
  if (!api) throw new Error('Unknown catalog entry');
  return client.request(api.endpoint, { method: api.method || 'POST', ...(api.method === 'GET' ? { query: params } : { data: params }) });
}
export async function status(client) {
  const [poll, recent, pools] = await Promise.all([
    readApi(client, 'system.polling'), readApi(client, 'system.recent'), readApi(client, 'storage.pools'),
  ]);
  const r = recent.list?.[0];
  return {
    model: r?.hard?.model || null,
    firmware: poll.pcversion,
    uptime: r?.uptime || null,
    cpu: { model: r?.cpu?.name, percent: r?.cpu?.used == null ? null : Math.round(r.cpu.used * 1000) / 10, temperatureC: r?.cpu?.temp },
    memory: { totalBytes: r?.memory?.total, percent: r?.memory?.used == null ? null : Math.round(r.memory.used * 1000) / 10 },
    pools: (pools.pool_list || []).map(p => ({ name: p.name, status: p.status, totalBytes: p.total_size, freeBytes: p.free_size, usedBytes: p.usage_size, disks: p.disk_list?.length || 0 })),
    sampledAt: r?.created_at || null,
  };
}
