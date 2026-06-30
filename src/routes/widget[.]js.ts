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
  // Don't run on own dashboard
  if (location.hostname === 'ai.wolvcapital.com') return;
  window.__wolvChat = true;
  var API = ${JSON.stringify(apiBase)};
  var SCRIPT = document.currentScript || (function(){ var s=document.getElementsByTagName('script'); for(var i=s.length-1;i>=0;i--){ if((s[i].src||'').indexOf('/widget.js')>-1) return s[i]; } return null; })();
  var SITE = (SCRIPT && (SCRIPT.getAttribute('data-site') || SCRIPT.getAttribute('data-site-id'))) || (window.__wolvChatSite) || '';
  var SS_KEY = 'wolv_sid_' + (SITE || 'default');
  var LEAD_KEY = 'wolv_lead_' + (SITE || 'default');
  var MIN_KEY = 'wolv_min_' + (SITE || 'default');
  var sid = localStorage.getItem(SS_KEY);
  if (!sid) { sid = 'wv_' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(SS_KEY, sid); }
  var savedLead = JSON.parse(localStorage.getItem(LEAD_KEY) || 'null');
  var wasMinimized = localStorage.getItem(MIN_KEY) === '1';

  var host = document.createElement('div');
  host.id = 'wolv-chat-root';
  host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });

  var css = \`
    *{box-sizing:border-box}
    .bubble{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#0a1628,#1e3a5f);border:2px solid #d4af37;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(0,0,0,.5);transition:transform .2s;position:relative}
    .bubble:hover{transform:scale(1.08)}
    .bubble svg{width:28px;height:28px;fill:#d4af37}
    .bubble .badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;width:18px;height:18px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;display:none}
    .bubble .badge.show{display:flex}
    .proactive{position:absolute;bottom:72px;right:0;background:#0a1628;border:1px solid #d4af37;border-radius:12px;padding:12px 14px;max-width:240px;font-size:13px;color:#e5e7eb;box-shadow:0 8px 24px rgba(0,0,0,.4);cursor:pointer;animation:fadein .3s}
    .proactive .close-pro{float:right;background:none;border:0;color:#8aa0c0;cursor:pointer;font-size:16px;line-height:1;margin-left:8px;padding:0}
    @keyframes fadein{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .panel{position:absolute;bottom:80px;right:0;width:380px;max-width:calc(100vw - 32px);height:580px;max-height:calc(100vh - 110px);background:#0a1628;border:1px solid #1e3a5f;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;color:#e5e7eb}
    .panel.open{display:flex}
    .hdr{padding:14px 16px;background:linear-gradient(135deg,#0a1628,#162846);border-bottom:1px solid #1e3a5f;display:flex;align-items:center;gap:10px;flex-shrink:0}
    .hdr .logo{width:34px;height:34px;border-radius:8px;background:#d4af37;display:flex;align-items:center;justify-content:center;font-weight:700;color:#0a1628;font-size:15px;flex-shrink:0}
    .hdr .meta{flex:1;min-width:0}
    .hdr .name{font-weight:600;font-size:13.5px;color:#fff}
    .hdr .sub{font-size:11px;color:#8aa0c0;display:flex;align-items:center;gap:5px;margin-top:2px}
    .hdr .dot{width:6px;height:6px;border-radius:50%;background:#10b981;flex-shrink:0}
    .hdr .close{background:transparent;border:0;color:#8aa0c0;cursor:pointer;font-size:20px;padding:4px;line-height:1}
    .msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#06101f}
    .msgs::-webkit-scrollbar{width:4px}.msgs::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
    .m{max-width:82%;padding:9px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
    .m.visitor{align-self:flex-end;background:#d4af37;color:#0a1628;border-bottom-right-radius:3px}
    .m.ai,.m.agent{align-self:flex-start;background:#162846;color:#e5e7eb;border-bottom-left-radius:3px;border:1px solid #1e3a5f}
    .m.agent{border-color:#d4af3788}
    .m.agent::before{content:'Agent · ';font-size:10px;color:#d4af37;display:block;margin-bottom:2px}
    .m.system{align-self:center;font-size:11px;color:#6b7d99;text-align:center;padding:3px 8px;background:rgba(255,255,255,.03);border-radius:20px;border:1px solid #1e3a5f}
    .m.error-msg{align-self:center;font-size:11px;color:#f87171;background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);border-radius:8px;padding:6px 12px;text-align:center}
    .typing{align-self:flex-start;display:flex;gap:4px;padding:11px 13px;background:#162846;border-radius:14px;border:1px solid #1e3a5f}
    .typing span{width:6px;height:6px;border-radius:50%;background:#8aa0c0;animation:tp 1.2s infinite}
    .typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
    @keyframes tp{0%,60%,100%{opacity:.3}30%{opacity:1}}
    /* Lead capture form */
    .lead-form{padding:20px;display:flex;flex-direction:column;gap:10px;background:#06101f;flex:1}
    .lead-form .lead-title{font-size:15px;font-weight:600;color:#fff;margin-bottom:4px}
    .lead-form .lead-sub{font-size:12px;color:#8aa0c0;margin-bottom:8px}
    .lead-inp{background:#162846;border:1px solid #1e3a5f;border-radius:10px;padding:10px 12px;color:#fff;font-size:13px;outline:none;font-family:inherit;width:100%}
    .lead-inp:focus{border-color:#d4af37}
    .lead-btn{background:#d4af37;color:#0a1628;border:0;border-radius:10px;padding:11px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit}
    .lead-btn:disabled{opacity:.5;cursor:not-allowed}
    .lead-skip{background:transparent;border:0;color:#6b7d99;font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit;padding:0}
    /* Offline form */
    .offline-form{padding:20px;display:flex;flex-direction:column;gap:10px;flex:1;background:#06101f}
    .offline-title{font-size:14px;font-weight:600;color:#fff}
    .offline-sub{font-size:12px;color:#8aa0c0}
    /* Input area */
    .frm{padding:10px 12px;border-top:1px solid #1e3a5f;background:#0a1628;flex-shrink:0}
    .row{display:flex;gap:8px}
    .ipt{flex:1;background:#162846;border:1px solid #1e3a5f;border-radius:10px;padding:9px 11px;color:#fff;font-size:13px;outline:none;font-family:inherit;resize:none;max-height:100px;line-height:1.4}
    .ipt:focus{border-color:#d4af37}
    .ipt::placeholder{color:#4a5568}
    .btn{background:#d4af37;color:#0a1628;border:0;border-radius:10px;padding:0 14px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;flex-shrink:0}
    .btn:disabled{opacity:.45;cursor:not-allowed}
    .actions{display:flex;justify-content:center;padding:6px 0 0}
    .lnk{background:transparent;border:0;color:#6b7d99;font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit}
    /* Satisfaction rating */
    .rating{padding:14px 16px;border-top:1px solid #1e3a5f;background:#0a1628;display:flex;align-items:center;gap:8px;flex-shrink:0}
    .rating .rtxt{font-size:11px;color:#8aa0c0;flex:1}
    .star{background:none;border:0;font-size:20px;cursor:pointer;padding:2px;opacity:.5;transition:opacity .15s}
    .star:hover,.star.sel{opacity:1}
  \`;
  var style = document.createElement('style'); style.textContent = css; root.appendChild(style);

  var state = {
    visitor: null, conversation: null, sb: null, ws: null,
    opened: false, retryCount: 0, leadDone: !!savedLead,
    unread: 0, showRating: false, proactiveShown: false,
    agentTyping: false
  };

  // ── DOM ──────────────────────────────────────────────
  function buildUI() {
    var wrap = document.createElement('div');

    // Bubble
    wrap.innerHTML = '<button class="bubble" id="bub" aria-label="Open chat">'
      + '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>'
      + '<span class="badge" id="badge"></span></button>';

    // Panel
    var panel = document.createElement('div');
    panel.className = 'panel'; panel.id = 'pnl';
    panel.innerHTML = '<div class="hdr">'
      + '<div class="logo">W</div>'
      + '<div class="meta"><div class="name">WolvCapital Support</div>'
      + '<div class="sub"><span class="dot"></span><span id="hdr-status">Typically replies instantly</span></div></div>'
      + '<button class="close" id="cls" aria-label="Close">×</button></div>'
      + '<div id="main-area" style="flex:1;display:flex;flex-direction:column;min-height:0">'
      + '<div class="msgs" id="msgs"></div>'
      + '</div>'
      + '<div class="frm" id="frm">'
      + '<div class="row"><textarea class="ipt" id="ipt" rows="1" placeholder="Ask about investments, staking, returns..."></textarea>'
      + '<button class="btn" id="snd">Send</button></div>'
      + '<div class="actions"><button class="lnk" id="hum">Talk to a human agent</button></div>'
      + '</div>';

    wrap.appendChild(panel);
    root.appendChild(wrap);
  }
  buildUI();

  var bub = root.getElementById('bub');
  var badge = root.getElementById('badge');
  var pnl = root.getElementById('pnl');
  var cls = root.getElementById('cls');
  var msgs = root.getElementById('msgs');
  var frm = root.getElementById('frm');
  var ipt = root.getElementById('ipt');
  var snd = root.getElementById('snd');
  var hum = root.getElementById('hum');
  var mainArea = root.getElementById('main-area');
  var hdrStatus = root.getElementById('hdr-status');

  // ── Helpers ──────────────────────────────────────────
  function getClientMeta() {
    return {
      language: navigator.language || undefined,
      timezone: Intl && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined,
      screen_width: screen.width || undefined,
      screen_height: screen.height || undefined,
    };
  }

  function msgEl(role, content) {
    var d = document.createElement('div');
    d.className = 'm ' + role;
    d.textContent = content;
    return d;
  }
  function appendMsg(m) {
    var existing = msgs.querySelector('[data-id="' + m.id + '"]');
    if (existing) return;
    var d = msgEl(m.role, m.content);
    if (m.id) d.dataset.id = m.id;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    // Unread badge when panel closed
    if (!pnl.classList.contains('open') && (m.role === 'ai' || m.role === 'agent')) {
      state.unread++;
      badge.textContent = state.unread;
      badge.classList.add('show');
    }
  }
  function showTyping(on) {
    var t = root.getElementById('typing-ind');
    if (on && !t) { t = document.createElement('div'); t.id='typing-ind'; t.className='typing'; t.innerHTML='<span></span><span></span><span></span>'; msgs.appendChild(t); msgs.scrollTop=msgs.scrollHeight; }
    else if (!on && t) t.remove();
  }
  function setHdrStatus(txt, online) {
    hdrStatus.textContent = txt;
    var dot = root.querySelector('.hdr .dot');
    if (dot) dot.style.background = online ? '#10b981' : '#f59e0b';
  }

  // ── API call ─────────────────────────────────────────
  async function api(payload) {
    try {
      var r = await fetch(API + '/api/public/widget', {
        method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload)
      });
      return await r.json();
    } catch(e) {
      return { __error: true, retry: true, message: 'Network error' };
    }
  }

  // ── Lead capture form ─────────────────────────────────
  function showLeadForm(onDone) {
    mainArea.innerHTML = '';
    var form = document.createElement('div');
    form.className = 'lead-form';
    form.innerHTML = '<div class="lead-title">Welcome to WolvCapital 👋</div>'
      + '<div class="lead-sub">Share your details so we can personalize your experience and follow up if needed.</div>'
      + '<input class="lead-inp" id="l-name" type="text" placeholder="Your name" />'
      + '<input class="lead-inp" id="l-email" type="email" placeholder="Email address (optional)" />'
      + '<button class="lead-btn" id="l-start">Start chatting →</button>'
      + '<button class="lead-skip" id="l-skip">Skip for now</button>';
    mainArea.appendChild(form);
    frm.style.display = 'none';

    function proceed() {
      var name = (root.getElementById('l-name').value || '').trim();
      var email = (root.getElementById('l-email').value || '').trim();
      var lead = { name: name || null, email: email || null };
      localStorage.setItem(LEAD_KEY, JSON.stringify(lead));
      state.leadDone = true;
      savedLead = lead;
      frm.style.display = '';
      onDone(lead);
    }

    root.getElementById('l-start').addEventListener('click', proceed);
    root.getElementById('l-skip').addEventListener('click', function() {
      localStorage.setItem(LEAD_KEY, JSON.stringify({}));
      state.leadDone = true;
      frm.style.display = '';
      mainArea.innerHTML = '<div class="msgs" id="msgs"></div>';
      msgs = root.getElementById('msgs');
      rebindMsgs();
      onDone({});
    });
  }

  // ── Chat area ─────────────────────────────────────────
  function showChat() {
    mainArea.innerHTML = '<div class="msgs" id="msgs"></div>';
    msgs = root.getElementById('msgs');
    rebindMsgs();
    frm.style.display = '';
  }

  function rebindMsgs() { /* msgs ref updated */ }

  // ── Satisfaction rating ───────────────────────────────
  function showRating() {
    if (state.showRating) return;
    state.showRating = true;
    var rDiv = document.createElement('div');
    rDiv.className = 'rating';
    rDiv.innerHTML = '<span class="rtxt">How was your experience?</span>'
      + [1,2,3,4,5].map(function(n){ return '<button class="star" data-v="'+n+'">'+['😞','😕','😐','😊','😄'][n-1]+'</button>'; }).join('');
    pnl.insertBefore(rDiv, frm);
    rDiv.querySelectorAll('.star').forEach(function(s) {
      s.addEventListener('click', function() {
        rDiv.querySelectorAll('.star').forEach(function(x){ x.classList.remove('sel'); });
        s.classList.add('sel');
        // Store rating locally — could send to API
        setTimeout(function(){ rDiv.innerHTML = '<span class="rtxt" style="color:#10b981">Thanks for your feedback! ✓</span>'; }, 300);
      });
    });
  }

  // ── Init flow ─────────────────────────────────────────
  async function init(lead) {
    var payload = Object.assign({
      action:'init', session_id: sid, site: SITE,
      current_page: location.href, referrer: document.referrer
    }, getClientMeta(), lead || {});

    if (lead && lead.name) payload.name = lead.name;
    if (lead && lead.email) payload.email = lead.email;

    var res = await api(payload);

    if (res && res.__error) {
      if (state.retryCount < 3) {
        state.retryCount++;
        setTimeout(function(){ init(lead); }, state.retryCount * 2000);
      } else {
        var errEl = document.createElement('div');
        errEl.className = 'm error-msg';
        errEl.textContent = 'Unable to connect. Please refresh and try again.';
        msgs && msgs.appendChild(errEl);
      }
      return;
    }

    state.retryCount = 0;
    if (res && res.conversation) {
      state.visitor = res.visitor;
      state.conversation = res.conversation;

      // Load history
      var h = await api({ action:'history', conversation_id: res.conversation.id });
      var messages = (h && h.messages) || [];

      if (msgs) {
        msgs.innerHTML = '';
        if (!messages.length) {
          appendMsg({ id:'welcome', role:'ai', content: lead && lead.name
            ? 'Hi ' + lead.name + '! Welcome to WolvCapital. I\'m your AI assistant — ask me anything about our investment plans, staking, or how to get started.'
            : 'Welcome to WolvCapital! I\'m your AI assistant. Ask me about our investment plans, staking rewards, fees, or how to get started.' });
        } else {
          messages.forEach(function(m){ appendMsg(m); });
        }
      }

      // Show rating if conversation is closed
      if (res.conversation.status === 'closed') showRating();
      // Update header if agent is handling
      if (res.conversation.status === 'human') setHdrStatus('Agent is online', true);

      subscribeRealtime(res.supabase, res.conversation.id);
    }
  }

  // ── Realtime ──────────────────────────────────────────
  function subscribeRealtime(cfg, convId) {
    if (state.ws) { try { state.ws.close(); } catch(e){} }
    var url = cfg.url.replace(/^https/, 'wss') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.anon) + '&vsn=1.0.0';
    var ws;
    try { ws = new WebSocket(url); } catch(e) { return; }
    var ref = 0;
    ws.onopen = function(){
      ws.send(JSON.stringify({
        topic:'realtime:public:messages:conversation_id=eq.'+convId,
        event:'phx_join',
        payload:{ config:{ postgres_changes:[{ event:'INSERT', schema:'public', table:'messages', filter:'conversation_id=eq.'+convId }] } },
        ref:String(++ref)
      }));
      setInterval(function(){ try{ ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:String(++ref)}));}catch(e){} }, 25000);
    };
    ws.onmessage = function(ev){
      try {
        var data = JSON.parse(ev.data);
        if (data.event === 'postgres_changes' && data.payload && data.payload.data && data.payload.data.record) {
          var rec = data.payload.data.record;
          showTyping(false);
          if (msgs) appendMsg({ id:rec.id, role:rec.role, content:rec.content });
          // Agent joined — update header
          if (rec.role === 'agent') setHdrStatus('Agent is replying', true);
          if (rec.role === 'system' && rec.content && rec.content.includes('closed')) showRating();
        }
      } catch(e){}
    };
    ws.onclose = function(){
      if (pnl.classList.contains('open')) {
        setTimeout(function(){ if (state.conversation) subscribeRealtime(cfg, convId); }, 5000);
      }
    };
    state.ws = ws;
    state._realtimeCfg = cfg;
  }

  // ── Send ──────────────────────────────────────────────
  async function send() {
    var v = ipt.value.trim();
    if (!v || !state.conversation) return;
    ipt.value = ''; ipt.style.height='auto';
    snd.disabled = true;
    if (msgs) appendMsg({ id:'tmp_'+Date.now(), role:'visitor', content:v });
    showTyping(true);
    var res = await api({ action:'send', conversation_id:state.conversation.id, content:v });
    snd.disabled = false;
    if (res && res.__error) {
      showTyping(false);
      var errEl = document.createElement('div');
      errEl.className = 'm error-msg';
      errEl.textContent = 'Message failed — please try again.';
      if (msgs) msgs.appendChild(errEl);
    }
  }

  // ── Proactive message (after 25s) ─────────────────────
  function maybeShowProactive() {
    if (state.proactiveShown || state.opened || pnl.classList.contains('open')) return;
    state.proactiveShown = true;
    var pro = document.createElement('div');
    pro.className = 'proactive';
    pro.innerHTML = '<button class="close-pro" id="pro-cls">×</button>'
      + '👋 Need help with investments or staking? I\'m here to assist!';
    host.insertBefore(pro, host.firstChild);
    pro.addEventListener('click', function(e){
      if (e.target.id === 'pro-cls') { pro.remove(); return; }
      pro.remove(); openChat();
    });
    setTimeout(function(){ if (pro.parentNode) pro.remove(); }, 10000);
  }
  setTimeout(maybeShowProactive, 25000);

  // ── Open chat ─────────────────────────────────────────
  function openChat() {
    pnl.classList.add('open');
    state.unread = 0;
    badge.classList.remove('show');
    localStorage.removeItem(MIN_KEY);

    if (!state.opened) {
      state.opened = true;
      if (!state.leadDone) {
        showLeadForm(function(lead) {
          showChat();
          init(lead);
        });
      } else {
        showChat();
        init(savedLead || {});
      }
    }
    setTimeout(function(){ ipt && ipt.focus(); }, 150);
  }

  // ── Events ────────────────────────────────────────────
  bub.addEventListener('click', openChat);
  cls.addEventListener('click', function(){
    pnl.classList.remove('open');
    localStorage.setItem(MIN_KEY, '1');
  });
  snd.addEventListener('click', send);
  ipt.addEventListener('keydown', function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }});
  ipt.addEventListener('input', function(){ ipt.style.height='auto'; ipt.style.height=Math.min(ipt.scrollHeight,100)+'px'; });
  hum.addEventListener('click', async function(){
    if (!state.conversation) return;
    await api({ action:'human', conversation_id:state.conversation.id });
    setHdrStatus('Connecting you to an agent...', true);
    hum.style.display = 'none';
  });

  // Auto-open if was not minimized and has history
  if (!wasMinimized && savedLead !== null) {
    // Silently init in background to track visitor
    api(Object.assign({ action:'init', session_id:sid, site:SITE, current_page:location.href, referrer:document.referrer }, getClientMeta(), savedLead || {}));
  } else if (savedLead === null) {
    // First ever visit — just track silently, no lead form until they open
    api(Object.assign({ action:'init', session_id:sid, site:SITE, current_page:location.href, referrer:document.referrer }, getClientMeta()));
  }

  // SPA page tracking
  var lastUrl = location.href;
  function track(){
    if (location.href === lastUrl) return; lastUrl = location.href;
    api({ action:'track', session_id:sid, current_page:location.href, title:document.title, referrer:document.referrer });
  }
  var _ps = history.pushState, _rs = history.replaceState;
  history.pushState = function(){ _ps.apply(this,arguments); setTimeout(track,50); };
  history.replaceState = function(){ _rs.apply(this,arguments); setTimeout(track,50); };
  window.addEventListener('popstate', track);
})();`;
}

export const Route = createFileRoute("/widget.js")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return new Response(buildWidgetSource(origin), { headers: cors });
      },
    },
  },
});
