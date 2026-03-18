/**
 * @file lib/jsSandbox.ts
 * LectureMate — JavaScript/TypeScript iframe 샌드박스 실행 (Section 5.2)
 *
 * ## 방식
 * sandbox="allow-scripts" 속성의 숨김 iframe을 생성하고
 * srcdoc에 코드를 주입 → postMessage로 결과 수신 → iframe 제거.
 *
 * ## 제한
 * - 네트워크 요청 불가 (allow-same-origin 없으므로 null origin)
 * - DOM 접근 불가 (parent 문서와 격리)
 * - 타임아웃: 10초
 * - TypeScript: new Function()으로 실행 (타입 어노테이션 무시)
 *
 * ## 출력 제한 (Section 10.3)
 * - stdout 최대 1000줄 / 1MB
 */

import type { JsSandboxResult } from '@/types'

// ============================================================
// 상수
// ============================================================

const TIMEOUT_MS   = 10_000
const MAX_LINES    = 1_000
const MAX_BYTES    = 1_048_576  // 1 MB

// ============================================================
// iframe HTML 템플릿
// ============================================================

function buildSrcdoc(source: string): string {
  // source를 JSON 문자열로 안전하게 삽입
  const safeSource = JSON.stringify(source)

  return `<!DOCTYPE html><html><body><script>(function(){
var _out=[],_err=[],_start=Date.now();
var _bytes=0,_limited=false;
function _push(arr,s){
  if(_limited)return;
  _bytes+=s.length;
  if(arr===_out&&(arr.length>=${MAX_LINES}||_bytes>=${MAX_BYTES})){
    _limited=true;
    arr.push('⚠️ 출력 한도 초과 (최대 1000줄 / 1MB)');
    return;
  }
  arr.push(s);
}
var console={
  log:function(){for(var i=0;i<arguments.length;i++)_push(_out,_fmt(arguments[i]));},
  error:function(){for(var i=0;i<arguments.length;i++)_push(_err,_fmt(arguments[i]));},
  warn:function(){for(var i=0;i<arguments.length;i++)_push(_out,'[warn] '+_fmt(arguments[i]));},
  info:function(){for(var i=0;i<arguments.length;i++)_push(_out,_fmt(arguments[i]));},
  dir:function(v){_push(_out,_fmt(v));},
  clear:function(){_out=[];_err=[];_bytes=0;_limited=false;},
};
function _fmt(v){
  if(v===null)return'null';
  if(v===undefined)return'undefined';
  if(typeof v==='object'){try{return JSON.stringify(v,null,2);}catch(e){return String(v);}}
  return String(v);
}
try{
  var _fn=new Function('console',${safeSource});
  var _r=_fn(console);
  if(_r!==undefined)_push(_out,_fmt(_r));
  parent.postMessage({type:'sb-result',ok:true,stdout:_out,stderr:_err,ms:Date.now()-_start},'*');
}catch(e){
  parent.postMessage({type:'sb-result',ok:false,stdout:_out,stderr:_err.concat(String(e)),ms:Date.now()-_start},'*');
}
})();<\/script></body></html>`
}

// ============================================================
// runInJsSandbox
// ============================================================

/**
 * JavaScript / TypeScript コードをiframe sandbox内で実行します。
 *
 * TypeScript は new Function() で実行されるため
 * 型 어노테이션 syntax が含まれている場合 SyntaxError가 발생할 수 있습니다.
 */
export function runInJsSandbox(
  source: string,
  timeoutMs = TIMEOUT_MS,
): Promise<JsSandboxResult> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.style.display  = 'none'
    iframe.style.position = 'absolute'
    iframe.style.width    = '0'
    iframe.style.height   = '0'
    document.body.appendChild(iframe)

    let settled = false

    function cleanup() {
      window.removeEventListener('message', onMessage)
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe)
      }
    }

    const timeoutId = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      resolve({
        stdout:        [],
        stderr:        [`⏱️ 실행 시간 초과 (${timeoutMs / 1000}초). 무한 루프가 있는지 확인해주세요.`],
        executionTime: timeoutMs,
        status:        'timeout',
      })
    }, timeoutMs)

    function onMessage(e: MessageEvent) {
      // 보낸 출처가 우리 iframe인지 확인
      if (e.source !== iframe.contentWindow) return
      if (!e.data || e.data.type !== 'sb-result') return
      if (settled) return

      settled = true
      clearTimeout(timeoutId)
      cleanup()

      const d = e.data as {
        ok:     boolean
        stdout: string[]
        stderr: string[]
        ms:     number
      }

      resolve({
        stdout:        d.stdout.slice(0, MAX_LINES),
        stderr:        d.stderr,
        executionTime: d.ms,
        status:        d.ok ? 'ok' : 'error',
      })
    }

    window.addEventListener('message', onMessage)
    iframe.srcdoc = buildSrcdoc(source)
  })
}
