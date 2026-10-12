#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4280;
const PROTOTYPE_FILE = path.resolve(__dirname, '../src/app/features/schedule/prototype-schedule-done-dialog.html');

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  
  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '/prototype') {
    fs.readFile(PROTOTYPE_FILE, (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error loading prototype: ${err.message}`);
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(data);
    });
  } else {
    // Serve any requested file relative to repo root if needed
    const requestedPath = path.join(__dirname, '..', parsedUrl.pathname);
    if (fs.existsSync(requestedPath) && fs.statSync(requestedPath).isFile()) {
      res.writeHead(200);
      fs.createReadStream(requestedPath).pipe(res);
    } else {
      // Default fallback to prototype
      fs.readFile(PROTOTYPE_FILE, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(` Task Completion & Schedule Dialog Prototype Running`);
  console.log(` URL: http://localhost:${PORT}/?variant=A&scenario=1`);
  console.log(`======================================================\n`);
});
