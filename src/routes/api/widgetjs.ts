import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=300",
  "Content-Type": "application/javascript; charset=utf-8",
};

function buildWidgetSource(apiBase: string): string {
  return `(function(){
  if (window.__wolvChat) return;
  window.__wolvChat = true;
  var API = ${JSON.stringify(apiBase)};
  var SCRIPT = document.currentScript || (function(){ var s=document.getElementsByTagName('script'); for (var i=s.length-1;i>=0;i--){ if ((s[i].src||'').indexOf('/widget.js')>-1) return s[i]; } return null; })();
  var SITE = (SCRIPT && (SCRIPT.getAttribute('data-site') || SCRIPT.getAttribute('data-site-id'))) || (window.__wolvChatSite) || '';
  var SS_KEY = 'wolv_session_id_' + (SITE || 'default');
  var sid = localStorage.getItem(SS_KEY);
  if (!sid) { sid = 'wv_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(SS_KEY, sid); }

  var host = document.createElement('div');
  host.id = 'wolv-chat-root';
  host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var css = \`
    *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    .bubble{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#0a1628,#1e3a5f);border:2px solid #d4af37;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.4);transition:transform .2s}
    .bubble:hover{transform:scale(1.06)}
    .bubble svg{width:28px;height:28px;fill:#d4af37}
    .panel{position:absolute;bottom:80px;right:0;width:380px;max-width:calc(100vw - 40px);height:560px;max-height:calc(100vh - 120px);background:#0a1628;border:1px solid #1e3a5f;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);display:none;flex-direction:column;overflow:hidden;color:#e5e7eb}
    .panel.open{display:flex}
    .hdr{padding:16px 18px;background:linear-gradient(135deg,#0a1628,#162846);border-bottom:1px solid #1e3a5f;display:flex;align-items:center;gap:12px}
    .hdr .logo{width:36px;height:36px;border-radius:8px;background:#d4af37;display:flex;align-items:center;justify-content:center;font-weight:700;color:#0a1628}
    .hdr .meta{flex:1}
    .hdr .name{font-weight:600;font-size:14px;color:#fff}
    .hdr .sub{font-size:11px;color:#8aa0c0;display:flex;align-items:center;gap:6px}
    .hdr .dot{width:6px;height:6px;border-radius:50%;background:#10b981}
    .hdr .close{background:transparent;border:0;color:#8aa0c0;cursor:pointer;font-size:20px;padding:4px}
    .msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;background:#06101f}
    .msgs::-webkit-scrollbar{width:6px}.msgs::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:3px}
    .m{max-width:80%;padding:10px 14px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
    .m.visitor{align-self:flex-end;background:#d4af37;color:#0a1628;border-bottom-right-radius:4px}
    .m.ai,.m.agent{align-self:flex-start;background:#162846;color:#e5e7eb;border-bottom-left-radius:4px;border:1px solid #1e3a5f}
    .m.agent{border-color:#d4af37}
    .m.system{align-self:center;font-size:11px;color:#6b7d99;background:transparent;text-align:center;padding:4px 8px}
    .typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#162846;border-radius:14px;border:1px solid #1e3a5f}
    .typing span{width:6px;height:6px;border-radius:50%;background:#8aa0c0;animation:tp 1.2s infinite}
    .typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
    @keyframes tp{0%,60%,100%{opacity:.3}30%{opacity:1}}
    .frm{padding:12px;border-top:1px solid #1e3a5f;background:#0a1628}
    .row{display:flex;gap:8px}
    .ipt{flex:1;background:#162846;border:1px solid #1e3a5f;border-radius:10px;padding:10px 12px;color:#fff;font-size:13px;outline:none;font-family:inherit;resize:none;max-height:100px}
    .ipt:focus{border-color:#d4af37}
    .btn{background:#d4af37;color:#0a1628;border:0;border-radius:10px;padding:0 14px;font-weight:600;cursor:pointer;font-size:13px}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .actions{display:flex;justify-content:center;padding:8px 0 0}
    .lnk{background:transparent;border:0;color:#8aa0c0;font-size:11px;cursor:pointer;text-decoration:underline}
    .intro{padding:24px;text-align:center;color:#8aa0c0;font-size:13px}
    .intro h3{color:#d4af37;margin:0 0 8px;font-size:16px}
    .field{display:block;margin-top:8px;width:100%;background:#162846;border:1px solid #1e3a5f;border-radius:8px;padding:8px 10px;color:#fff;font-size:13px;outline:none}
  \`;
  var style = document.createElement('style'); style.textContent = css; root.appendChild(style);

  var html = '<button class="bubble" id="bub" aria-label="Open chat"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></button>'
    + '<div class="panel" id="pnl">'
    + '<div class="hdr"><div class="logo">W</div><div class="meta"><div class="name">WolvCapital Support</div><div class="sub"><span class="dot"></span>Typically replies instantly</div></div><button class="close" id="cls">×</button></div>'
    + '<div class="msgs" id="msgs"></div>'
    + '<div class="frm">'
    + '<div class="row"><textarea class="ipt" id="ipt" rows="1" placeholder="Ask about investments, fees, returns..."></textarea><button class="btn" id="snd">Send</button></div>'
    + '<div class="actions"><button class="lnk" id="hum">Talk to a human</button></div>'
    + '</div></div>';
  var wrap = document.createElement('div'); wrap.innerHTML = html; root.appendChild(wrap);

  var bub = root.getElementById('bub'), pnl = root.getElementById('pnl'), cls = root.getElementById('cls');
  var msgs = root.getElementById('msgs'), ipt = root.getElementById('ipt'), snd = root.getElementById('snd'), hum = root.getElementById('hum');

  var state = { visitor: null, conversation: null, sb: null, channel: null, opened: false };

  function el(role, content) {
    var d = document.createElement('div');
    d.className = 'm ' + role;
    d.textContent = content;
    return d;
  }
  function render(list) {
    msgs.innerHTML = '';
    list.forEach(function(m){ msgs.appendChild(el(m.role, m.content)); });
    msgs.scrollTop = msgs.scrollHeight;
  }
  function append(m) {
    var existing = Array.from(msgs.querySelectorAll('.m')).find(function(n){ return n.dataset && n.dataset.id === m.id; });
    if (existing) return;
    var d = el(m.role, m.content);
    d.dataset.id = m.id;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function showTyping(on){
    var t = root.getElementById('typing');
    if (on && !t){ t = document.createElement('div'); t.id='typing'; t.className='typing'; t.innerHTML='<span></span><span></span><span></span>'; msgs.appendChild(t); msgs.scrollTop=msgs.scrollHeight; }
    else if (!on && t) t.remove();
  }

  async function api(payload) {
    var r = await fetch(API + '/api/public/widget', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(payload) });
    return r.json();
  }

  async function init() {
    var res = await api({ action:'init', session_id: sid, site: SITE, current_page: location.href, referrer: document.referrer });
    if (res && res.conversation) {
      state.visitor = res.visitor; state.conversation = res.conversation;
      var h = await api({ action:'history', conversation_id: res.conversation.id });
      render(h.messages || []);
      if (!h.messages || h.messages.length === 0) {
        append({ id:'welcome', role:'ai', content:"Welcome to WolvCapital. I'm your AI assistant — ask me anything about our investment strategies, fees, or how to get started." });
      }
      subscribeRealtime(res.supabase, res.conversation.id);
    }
  }

  function subscribeRealtime(cfg, convId) {
    // Lightweight realtime via Supabase WebSocket (no SDK)
    var url = cfg.url.replace(/^https/, 'wss') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.anon) + '&vsn=1.0.0';
    var ws = new WebSocket(url);
    var ref = 0;
    ws.onopen = function(){
      ws.send(JSON.stringify({
        topic: 'realtime:public:messages:conversation_id=eq.' + convId,
        event: 'phx_join',
        payload: { config: { postgres_changes: [{ event: 'INSERT', schema:'public', table:'messages', filter:'conversation_id=eq.'+convId }] } },
        ref: String(++ref)
      }));
      setInterval(function(){ try{ ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:String(++ref)}));}catch(e){} }, 25000);
    };
    ws.onmessage = function(ev){
      try {
        var data = JSON.parse(ev.data);
        if (data.event === 'postgres_changes' && data.payload && data.payload.data && data.payload.data.record) {
          var rec = data.payload.data.record;
          showTyping(false);
          append({ id: rec.id, role: rec.role, content: rec.content });
        }
      } catch(e){}
    };
    state.ws = ws;
  }

  async function send() {
    var v = ipt.value.trim(); if (!v || !state.conversation) return;
    ipt.value = ''; ipt.style.height='auto';
    append({ id: 'tmp_'+Date.now(), role:'visitor', content: v });
    showTyping(true);
    await api({ action:'send', conversation_id: state.conversation.id, content: v });
  }

  bub.addEventListener('click', function(){
    pnl.classList.add('open');
    if (!state.opened) { state.opened = true; init(); }
    setTimeout(function(){ ipt.focus(); }, 100);
  });
  cls.addEventListener('click', function(){ pnl.classList.remove('open'); });
  snd.addEventListener('click', send);
  ipt.addEventListener('keydown', function(e){ if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }});
  ipt.addEventListener('input', function(){ ipt.style.height='auto'; ipt.style.height=Math.min(ipt.scrollHeight,100)+'px'; });
  hum.addEventListener('click', async function(){
    if (!state.conversation) return;
    await api({ action:'human', conversation_id: state.conversation.id });
  });

  // Page tracking on SPA navigation
  var lastUrl = location.href;
  function track(){
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    api({ action:'track', session_id: sid, current_page: location.href, title: document.title, referrer: document.referrer });
  }
  var _ps = history.pushState, _rs = history.replaceState;
  history.pushState = function(){ _ps.apply(this, arguments); setTimeout(track, 50); };
  history.replaceState = function(){ _rs.apply(this, arguments); setTimeout(track, 50); };
  window.addEventListener('popstate', track);
  // Initial fire-and-forget so visitor is registered before opening
  api({ action:'init', session_id: sid, site: SITE, current_page: location.href, referrer: document.referrer });
})();`;
}

export const Route = createFileRoute("/api/widgetjs")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async () => new Response("ok", { headers: cors }),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return new Response(buildWidgetSource(origin), { headers: cors });
      },
    },
  },
});
