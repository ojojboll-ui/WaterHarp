// node serve.js            -> http://localhost:8092 (the PC) + https://<lan-ip>:8444 (the phone)
// The phone needs https for the motion sensor. The certificate is self-signed:
// the first time, Safari says "This connection is not private" -> Show details -> visit this website.
const http = require('http'), https = require('https'), fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname, HTTP_PORT = +process.env.PORT || 8092, HTTPS_PORT = +process.env.HTTPS_PORT || 8444;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function lanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || [])
    if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  return out;
}
const ips = lanIPs();

function ensureCert() {
  const dir = path.join(ROOT, 'certs'), key = path.join(dir, 'key.pem'), crt = path.join(dir, 'cert.pem'), tag = path.join(dir, 'ips.txt');
  const want = ips.join(',');
  if (fs.existsSync(key) && fs.existsSync(crt) && fs.existsSync(tag) && fs.readFileSync(tag, 'utf8') === want) return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
  fs.mkdirSync(dir, { recursive: true });
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map(ip => 'IP:' + ip)].join(',');
  const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  for (const exe of candidates) {
    try {
      execFileSync(exe, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '825',
        '-subj', '/CN=waterharp-local', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
      fs.writeFileSync(tag, want);
      return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
    } catch (e) { /* try the next one */ }
  }
  return null;
}

function handler(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/lan.json') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ urls: ips.map(ip => `https://${ip}:${HTTPS_PORT}/`) }));
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || file.includes(path.join(ROOT, 'certs'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

http.createServer(handler).listen(HTTP_PORT, '127.0.0.1', () => console.log(`PC:      http://localhost:${HTTP_PORT}/`));
const tls = ensureCert();
if (tls) {
  https.createServer(tls, handler).listen(HTTPS_PORT, '0.0.0.0', () => {
    for (const ip of ips) console.log(`Phone:   https://${ip}:${HTTPS_PORT}/   (same Wi-Fi)`);
  });
} else console.log('No openssl found, so only http runs. Install Git for Windows or put certs/key.pem + cert.pem here.');
