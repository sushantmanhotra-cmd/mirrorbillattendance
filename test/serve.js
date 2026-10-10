/* A static file server for the app, so it loads the way a phone loads it —
   over http — rather than from file://. No dependencies; there is no build
   step. node test/serve.js [port] */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream'
};

function serve(root, port) {
  const server = http.createServer(function (req, res) {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const file = path.join(root, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    fs.readFile(file, function (err, body) {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    });
  });
  return new Promise(function (resolve) { server.listen(port, '127.0.0.1', function () { resolve(server); }); });
}

module.exports = serve;
if (require.main === module) {
  const port = Number(process.argv[2]) || 5173;
  serve(path.join(__dirname, '..'), port).then(function () {
    console.log('Haazri on http://localhost:' + port + '  (add ?emu=1 to use the emulators)');
  });
}
