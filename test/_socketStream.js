'use strict';

const fs = require('fs');
const duplexer = require('duplexer');
const semver = require('semver');
const should = require('should');
const stream = require('readable-stream');

module.exports = function createSocketStream(file, length) {
  // Create a duplex stream

  const httpReqStream = new stream.PassThrough();
  const httpResStream = new stream.PassThrough();
  const socketStream = duplexer(httpReqStream, httpResStream);

  // Node 4.x requires cork/uncork
  socketStream.cork = function() {
  };

  socketStream.uncork = function() {
  };

  socketStream.destroy = function() {
  };

  socketStream.req = httpReqStream;
  socketStream.res = httpResStream;

  const wsdl = fs.readFileSync(file).toString('utf8');
  // Should be able to read from stream the request
  socketStream.req.once('readable', () => {
    const chunk = socketStream.req.read();
    should.exist(chunk);

    const header = `HTTP/1.1 200 OK\r\nContent-Type: text/xml; charset=utf-8\r\nContent-Length: ${length}\r\n\r\n`;

    // This is for compatibility with old node releases <= 0.10
    // Hackish
    if(semver.lt(process.version, '0.11.0'))
    {
      socketStream.on('data', data => {
        socketStream.ondata(data, 0, length + header.length);
      });
    }
    // Now write the response with the wsdl
    const state = socketStream.res.write(header + wsdl);
  });

  return socketStream;
};
