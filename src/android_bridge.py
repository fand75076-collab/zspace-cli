"""Optional Android UI transport. No NAS password extraction, proxy or arbitrary shell."""
import contextlib
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

PACKAGE = 'com.zentraedi.zspace'
HOME = 'com.zentraedi.home.activity.NasHomeActivity'
APPS = {
    'home': ('极空间首页', HOME),
    'bookLib': ('极阅读', 'BookMainActivity'),
    'comics': ('极漫画', 'ComicMainActivity'),
    'family': ('亲情设置', 'FamilyServiceActivity'),
    'mobileBackup': ('手机备份', 'BackupMainActivity'),
}

class BridgeError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message

def fail(code, message):
    raise BridgeError(code, message)

def validate_request(req):
    fields = {
        'status': set(), 'screen': set(), 'open': {'app'}, 'tap': {'target'},
        'set-text': {'target','text'}, 'scroll': {'target','direction'}, 'back': set(),
    }
    if not isinstance(req,dict) or not isinstance(req.get('action'),str) or req['action'] not in fields:
        fail('USAGE','未知安卓操作。')
    if set(req)-fields[req['action']]-{'action','serial'}:
        fail('USAGE','安卓操作包含未知字段。')
    if 'serial' in req and (not isinstance(req['serial'],str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,100}',req['serial'])):
        fail('USAGE','非法设备序列号。')
    action=req['action']
    if action=='open' and req.get('app') not in APPS: fail('USAGE','未知安卓应用入口。')
    if action in ('tap','set-text') or 'target' in req:
        if not isinstance(req.get('target'),str) or not re.fullmatch(r'[a-f0-9]{24}',req['target']): fail('USAGE','target 必须来自最新 screen 返回的控件标识。')
    if action=='set-text' and (not isinstance(req.get('text'),str) or len(req['text'])>4000):
        fail('USAGE','text 必须为不超过 4000 字符的文本。')
    if action=='scroll' and req.get('direction') not in ('up','down'): fail('USAGE','direction 必须为 up 或 down。')
    return req

def choose_device(req):
    try:
        raw=subprocess.run(['adb','devices'],check=True,capture_output=True,text=True,timeout=10).stdout
    except (OSError,subprocess.SubprocessError): fail('ADB_REQUIRED','没有可用的 adb；请安装 Android platform-tools。')
    devices=[line.split() for line in raw.splitlines()[1:] if line.strip()]
    selected=req.get('serial') or os.environ.get('ZSPACE_ANDROID_SERIAL')
    if selected:
        selected=next((d for d in devices if d[0]==selected),None)
        if not selected: fail('ANDROID_NOT_CONNECTED','指定安卓设备未连接。')
    else:
        if len(devices)!=1: fail('ANDROID_DEVICE_SELECTION','需要恰好一台已授权手机，或用 --serial 指定设备。')
        selected=devices[0]
    if len(selected)<2 or selected[1]!='device': fail('ANDROID_NOT_AUTHORIZED','手机未就绪，请在手机上完成 USB 调试授权和解锁。')
    return selected[0]

@contextlib.contextmanager
def device_lock(serial):
    # A process lock serializes CLI/MCP actions; the OS releases it on timeout/crash.
    identity=str(getattr(os,'getuid',lambda:os.environ.get('USERNAME','user'))())+serial
    name='zspace-android-'+hashlib.sha256(identity.encode()).hexdigest()[:24]+'.lock'
    path=os.path.join(tempfile.gettempdir(),name)
    fd=os.open(path,os.O_CREAT|os.O_RDWR|getattr(os,'O_NOFOLLOW',0),0o600)
    try:
        try:
            if os.name=='nt':
                import msvcrt
                if os.fstat(fd).st_size==0: os.write(fd,b'0')
                os.lseek(fd,0,os.SEEK_SET);msvcrt.locking(fd,msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError: fail('ANDROID_BUSY','另一条 CLI/MCP 调用正在使用这台手机。')
        yield
    finally: os.close(fd)

def bounds(value):
    m=re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]',value or '')
    return tuple(map(int,m.groups())) if m else None

def screen_data(xml,activity,size=None):
    root=ET.fromstring(xml)
    appnodes=[n for n in root.iter('node') if n.get('package')==PACKAGE]
    labels=[n.get('text','')[:100] for n in appnodes if n.get('text') and n.get('password')!='true'][:2]
    context=[activity,labels]
    result=[];bindings={}
    for n in appnodes:
        a=n.attrib;b=bounds(a.get('bounds'))
        if not b or b[2]<=b[0] or b[3]<=b[1] or a.get('visible-to-user')=='false': continue
        if size:
            b=(max(0,b[0]),max(0,b[1]),min(size[0],b[2]),min(size[1],b[3]))
            if b[2]<=b[0] or b[3]<=b[1]:continue
        protected=a.get('password')=='true'
        label='[PROTECTED]' if protected else (a.get('text') or a.get('content-desc') or '')
        clickable=a.get('clickable')=='true';scrollable=a.get('scrollable')=='true'
        editable='EditText' in a.get('class','') or a.get('editable')=='true'
        if not label and not (clickable or scrollable or editable): continue
        # Bounds, semantic attributes, activity, and screen heading bind tokens to the current UI.
        identity=[context,b,a.get('resource-id'),a.get('class'),label,clickable,scrollable,editable,a.get('enabled'),a.get('checked'),a.get('selected')]
        token=hashlib.sha256(json.dumps(identity,ensure_ascii=False).encode()).hexdigest()[:24]
        item={'target':token,'text':label[:2000],'resourceId':a.get('resource-id',''),'class':a.get('class',''),'bounds':b,'clickable':clickable,'scrollable':scrollable,'editable':editable,'enabled':a.get('enabled')!='false','selected':a.get('selected')=='true','checked':a.get('checked')=='true','protected':protected}
        result.append(item);bindings[token]=n
    return result,bindings

def require_app(d):
    # Android may briefly report no resumed activity during its own transition.
    for attempt in range(5):
        current=d.app_current()
        if current.get('package')==PACKAGE:return current.get('activity','')
        if attempt<4:time.sleep(.15)
    fail('ANDROID_FOREGROUND_REQUIRED','请在已解锁手机上打开已登录的极空间 App；桥接只操作该 App。')

def snapshot(d):
    error='ANDROID_UI_BLOCKED'
    for attempt in range(5):
        activity=require_app(d);xml=d.dump_hierarchy();size=d.window_size();elements,bindings=screen_data(xml,activity,size)
        # After a tap/back the activity can change while Android dumps the tree.
        # Retry only observation, never the input action that initiated the change.
        if elements:
            if require_app(d)==activity:
                return {'activity':activity,'visibleOnly':True,'viewport':{'width':size[0],'height':size[1]},'elements':elements},bindings
            error='ANDROID_STALE_SCREEN'
        if attempt<4:time.sleep(.15)
    # A permission prompt/keyboard/other app must never become a selectable target.
    if error=='ANDROID_STALE_SCREEN':fail(error,'界面仍在跳转，请重新读取。')
    fail(error,'极空间界面不可读取，可能正在加载或被系统弹窗遮挡；请在手机确认。')

def navigation_safe(screen):
    if any(e['editable'] for e in screen['elements']): fail('ANDROID_EDIT_IN_PROGRESS','当前界面有编辑框；请先保存或取消，再打开其他应用。')
    if any(e['resourceId'].startswith('android:id/button') for e in screen['elements']): fail('ANDROID_DIALOG','请先处理当前对话框。')

def get_target(screen,bindings,token,kind=None):
    item=next((x for x in screen['elements'] if x['target']==token),None)
    if not item: fail('ANDROID_STALE_TARGET','控件已变化或 target 不属于当前界面；请重新 screen 后选择。')
    if not item['enabled']: fail('ANDROID_DISABLED_TARGET','控件当前不可用。')
    if item['protected']: fail('ANDROID_PROTECTED_INPUT','密码或敏感验证输入需由用户在手机上完成。')
    if kind and not item[kind]: fail('ANDROID_TARGET_TYPE','控件不支持该操作。')
    return item,bindings[token]

def center(item):
    l,t,r,b=item['bounds'];return ((l+r)//2,(t+b)//2)

def wait_new_activity(d,previous,timeout=8):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if require_app(d)!=previous:return
        time.sleep(.15)

def tap_item(d,item):
    require_app(d);d.click(*center(item))

def open_app(d,app):
    screen,_=snapshot(d);navigation_safe(screen)
    if screen['activity']!=HOME:
        homes=[e for e in screen['elements'] if e['resourceId']==PACKAGE+':id/iv_home']
        if homes:
            tap_item(d,homes[0]);wait_new_activity(d,screen['activity'])
        else:
            # Read-only navigation only; never dismiss a save/consent dialog automatically.
            for _ in range(5):
                screen,_=snapshot(d);navigation_safe(screen)
                if screen['activity']==HOME:break
                d.press('back');wait_new_activity(d,screen['activity'],2)
    if require_app(d)!=HOME: fail('ANDROID_HOME_REQUIRED','无法自动返回极空间首页，请在手机点首页后重试。')
    if app=='home':return snapshot(d)[0]
    label,expected=APPS[app];opened_all=False
    for _ in range(7):
        screen,_=snapshot(d)
        matches=[e for e in screen['elements'] if e['text']==label and e['enabled']]
        if len(matches)==1:
            before=screen['activity'];tap_item(d,matches[0]);wait_new_activity(d,before)
            after=snapshot(d)[0]
            if not after['activity'].endswith(expected):
                fail('ANDROID_APP_NOT_OPENED','应用入口未到达预期页面；可能有权限、安装或首次使用提示，请查看手机。')
            after['app']=app;return after
        all_apps=[e for e in screen['elements'] if e['text']=='全部应用' and e['enabled']]
        if all_apps and not opened_all:
            tap_item(d,all_apps[0]);opened_all=True
        else:
            scrolls=[e for e in screen['elements'] if e['scrollable']]
            if not scrolls:break
            scroll(d,max(scrolls,key=lambda e:(e['bounds'][2]-e['bounds'][0])*(e['bounds'][3]-e['bounds'][1])),'down')
    fail('ANDROID_APP_NOT_FOUND','当前手机的应用列表里没有找到该入口。')

def scroll(d,item,direction):
    l,t,r,b=item['bounds'];x=(l+r)//2;y1=t+int((b-t)*.78);y2=t+int((b-t)*.22)
    if direction=='up':y1,y2=y2,y1
    require_app(d);d.swipe(x,y1,x,y2,.5)

def perform(d,req,serial):
    action=req['action']
    if action=='status':
        current=d.app_current();info=d.app_info(PACKAGE)
        return {'connected':True,'serial':serial,'package':PACKAGE,'version':info.get('versionName'),'foreground':current.get('package')==PACKAGE,'activity':current.get('activity') if current.get('package')==PACKAGE else None}
    if action=='open':return open_app(d,req['app'])
    before,bindings=snapshot(d)
    if action=='screen':return before
    if action=='tap':
        item,_=get_target(before,bindings,req['target']);tap_item(d,item)
    elif action=='set-text':
        item,node=get_target(before,bindings,req['target'],'editable')
        # Select only the current, verified editable node; no global text/key injection.
        options={'className':node.get('class')}
        if node.get('resource-id'):options['resourceId']=node.get('resource-id')
        candidates=d(**options);chosen=None
        for i in range(candidates.count):
            b=candidates[i].info['bounds']
            if tuple(b[k] for k in ('left','top','right','bottom'))==bounds(node.get('bounds')):chosen=candidates[i];break
        if chosen is None:fail('ANDROID_STALE_TARGET','输入框已经变化，请重新读取界面。')
        require_app(d);chosen.set_text(req['text'],timeout=3)
    elif action=='scroll':
        if 'target' in req:item,_=get_target(before,bindings,req['target'],'scrollable')
        else:
            found=[x for x in before['elements'] if x['scrollable'] and x['enabled']]
            if not found:fail('ANDROID_NOT_SCROLLABLE','当前界面没有可滚动区域。')
            item=max(found,key=lambda e:(e['bounds'][2]-e['bounds'][0])*(e['bounds'][3]-e['bounds'][1]))
        scroll(d,item,req['direction'])
    elif action=='back':
        if before['activity']==HOME:fail('ANDROID_AT_HOME','已经在极空间首页，拒绝退出到其他 App。')
        require_app(d);d.press('back')
    after,after_bindings=snapshot(d)
    if action=='set-text':
        if not any(e['editable'] and not e['protected'] and e['resourceId']==item['resourceId'] and after_bindings[e['target']].get('text','')==req['text'] for e in after['elements']):fail('ANDROID_TEXT_NOT_VERIFIED','未能在当前输入框中确认输入内容，请检查手机。')
    changed=after!=before
    after['action']=action;after['changed']=changed
    return after

def main():
    try:
        req=validate_request(json.loads(sys.stdin.read(1048576)))
        serial=choose_device(req)
        try:import uiautomator2 as u2
        except ImportError:fail('ANDROID_DEPENDENCY','安卓桥接需要 uiautomator2；请在独立 Python 环境安装，并通过 ZSPACE_ANDROID_PYTHON 指定解释器。')
        with device_lock(serial),contextlib.redirect_stdout(io.StringIO()):
            result=perform(u2.connect(serial),req,serial)
        response={'ok':True,'result':result}
    except BridgeError as e:response={'ok':False,'error':{'code':e.code,'message':e.message}}
    except Exception:response={'ok':False,'error':{'code':'ANDROID_RUNTIME','message':'安卓操作失败，请确认手机已解锁、USB 已授权且极空间处于前台。'}}
    print(json.dumps(response,ensure_ascii=False))

if __name__=='__main__':main()
