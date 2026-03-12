// PayPay集金チェッカー サーバー v2（料金区分・自己申告・PayPayリンク対応）
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, '.data', 'events.json');

// .dataディレクトリを作成（Glitchで永続化されるフォルダ）
function ensureDataDir() {
    const dir = path.join(__dirname, '.data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// データ読み込み
function loadEvents() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) { return {}; }
}

// データ保存
function saveEvents(events) {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2));
}

// リクエストボディ取得
function getBody(req) {
    return new Promise(resolve => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
    });
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    // CORS対応
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // API: イベント作成
    if (pathname === '/api/create' && req.method === 'POST') {
        const body = await getBody(req);
        const id = crypto.randomBytes(4).toString('hex');
        const events = loadEvents();
        // priceTiers: [{ label: '男子', amount: 5000 }, { label: '女子', amount: 3000 }]
        const tiers = Array.isArray(body.priceTiers) && body.priceTiers.length > 0
            ? body.priceTiers.filter(t => t.label && t.amount > 0)
            : [{ label: '一般', amount: body.amount || 0 }];
        events[id] = {
            id, name: body.name || '集金',
            paypayLink: body.paypayLink || '',
            priceTiers: tiers,
            members: [], created: new Date().toISOString()
        };
        saveEvents(events);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id }));
        return;
    }

    // API: イベント取得
    if (pathname.match(/^\/api\/event\//) && req.method === 'GET') {
        const id = pathname.split('/')[3];
        const events = loadEvents();
        if (!events[id]) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(events[id]));
        return;
    }

    // API: 参加登録
    if (pathname.match(/^\/api\/join\//) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await getBody(req);
        const events = loadEvents();
        if (!events[id]) { res.writeHead(404); res.end('Not found'); return; }
        const name = (body.name || '').trim();
        const tier = body.tier || '';
        if (!name) { res.writeHead(400); res.end('Name required'); return; }
        // 重複チェック
        if (events[id].members.find(m => m.name === name)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'already_joined' }));
            return;
        }
        // 料金区分から金額を取得
        const tierInfo = events[id].priceTiers.find(t => t.label === tier);
        const amount = tierInfo ? tierInfo.amount : (events[id].priceTiers[0]?.amount || 0);
        events[id].members.push({
            name, tier: tier || events[id].priceTiers[0]?.label || '一般',
            amount, paid: false, selfReported: false,
            joinedAt: new Date().toISOString(), paidAt: null
        });
        saveEvents(events);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // API: 支払い状態切り替え（幹事用）
    if (pathname.match(/^\/api\/toggle\//) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await getBody(req);
        const events = loadEvents();
        if (!events[id]) { res.writeHead(404); res.end('Not found'); return; }
        const member = events[id].members.find(m => m.name === body.name);
        if (member) {
            member.paid = !member.paid;
            member.paidAt = member.paid ? new Date().toISOString() : null;
            saveEvents(events);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // API: 自己申告（メンバーが自分で送金済みを報告）
    if (pathname.match(/^\/api\/self-report\//) && req.method === 'POST') {
        const id = pathname.split('/')[3];
        const body = await getBody(req);
        const events = loadEvents();
        if (!events[id]) { res.writeHead(404); res.end('Not found'); return; }
        const member = events[id].members.find(m => m.name === body.name);
        if (member && !member.paid) {
            member.paid = true;
            member.paidAt = new Date().toISOString();
            member.selfReported = true;
            saveEvents(events);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
    }

    // フロントエンド配信: /collect または /collect/:id
    if (pathname === '/' || pathname === '/collect' || pathname.startsWith('/collect/')) {
        fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, d) => {
            if (e) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
            res.end(d);
        });
        return;
    }

    res.writeHead(404); res.end('Not found');
});

ensureDataDir();
server.listen(PORT, '0.0.0.0', () => console.log(`集金チェッカーサーバー v2 起動: ポート ${PORT}`));
