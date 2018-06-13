'use strict';

const fs = require('fs');
const soap = require('..');
const http = require('http');
const assert = require('assert');
const duplexer = require('duplexer');
const req = require('request');
const httpClient = require('../lib/http.js');
const stream = require('readable-stream');
const util = require('util');
const { EventEmitter } = require('events');
const semver = require('semver');
const should = require('should');

it('should allow customization of httpClient and the wsdl file download should pass through it', done => {

  // Make a custom http agent to use streams instead on net socket
  class CustomAgent extends EventEmitter {
    constructor(options, socket){
      super();
      this.requests = [];
      this.maxSockets = 1;
      this.proxyStream = socket;
      this.options = options || {};
      this.proxyOptions = {};
    }

    addRequest(req, options) {
      req.onSocket(this.proxyStream);
    }
  }

  // Custom httpClient
  class MyHttpClient extends httpClient {
    constructor(options, socket){
      super(options);
      this.agent = new CustomAgent(options, socket);
    }


    request(rurl, data, callback, exheaders, exoptions) {
      const self = this;
      const options = self.buildRequest(rurl, data, exheaders, exoptions);
      // Specify agent to use
      options.agent = this.agent;
      const { headers } = options;
      const req = self._request(options, (err, res, body) => {
        if (err) {
          return callback(err);
        }
        body = self.handleResponse(req, res, body);
        callback(null, res, body);
      });
      if (headers.Connection !== 'keep-alive') {
        req.end(data);
      }
      return req;
    };
  }

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

  const wsdl = fs.readFileSync('./test/wsdl/default_namespace.wsdl').toString('utf8');
  // Should be able to read from stream the request
  httpReqStream.once('readable', () => {
    const chunk = httpReqStream.read();
    should.exist(chunk);

    // This is for compatibility with old node releases <= 0.10
    // Hackish
    if(semver.lt(process.version, '0.11.0'))
    {
      socketStream.on('data', data => {
        socketStream.ondata(data, 0, 1984);
      });
    }
    // Now write the response with the wsdl
    const state = httpResStream.write(`HTTP/1.1 200 OK\r\nContent-Type: text/xml; charset=utf-8\r\nContent-Length: 1904\r\n\r\n${wsdl}`);
  });

  const httpCustomClient = new MyHttpClient({}, socketStream);
  const url = 'http://localhost:50000/Platform.asmx?wsdl';
  soap.createClient(url,
    { httpClient: httpCustomClient },
    (err, client) => {
      assert.ok(client);
      assert.ifError(err);
      assert.equal(client.httpClient, httpCustomClient);
      const description = (client.describe());
      assert.deepEqual(client.describe(), {
        MyService: {
          MyServicePort: {
            MyOperation: {
              input: {
              },
              output: {
              }
            }
          }
        }
      });
      done();
    });
});
