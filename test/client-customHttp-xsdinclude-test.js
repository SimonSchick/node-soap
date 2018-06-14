'use strict';

const soap = require('..');
const assert = require('assert');
const httpClient = require('../lib/http.js');
const { EventEmitter } = require('events');
const createSocketStream = require('./_socketStream');

it('should allow customization of httpClient, the wsdl file, and associated data download should pass through it', done => {

  // Make a custom http agent to use streams instead of a real net socket
  class CustomAgent extends EventEmitter {
    constructor(options, wsdl, xsd) {
      super();
      this.requests = [];
      this.maxSockets = 1;
      this.wsdlStream = wsdl;
      this.xsdStream = xsd;
      this.options = options || {};
      this.proxyOptions = {};
    }

    addRequest(req, options) {
      if (/\?xsd$/.test(req.path)) {
        req.onSocket(this.xsdStream);
      } else {
        req.onSocket(this.wsdlStream);
      }
    }
  }

  // Custom httpClient
  class MyHttpClient extends httpClient {
    constructor(options, wsdlSocket, xsdSocket) {
      super(options);
      this.agent = new CustomAgent(options, wsdlSocket, xsdSocket);
    }

    request(rurl, data, callback, exheaders, exoptions) {
      const options = this.buildRequest(rurl, data, exheaders, exoptions);
      // Specify agent to use
      options.agent = this.agent;
      const { headers } = options;
      const req = this._request(options, (err, res, body) => {
        if (err) {
          callback(err);
          return;
        }
        body = this.handleResponse(req, res, body);
        callback(null, res, body);
      });
      if (headers.Connection !== 'keep-alive') {
        req.end(data);
      }
      return req;
    }
  }

  const httpCustomClient = new MyHttpClient(
    {},
    createSocketStream(`${__dirname}/wsdl/xsdinclude/xsd_include_http.wsdl`, 2708),
    createSocketStream(`${__dirname}/wsdl/xsdinclude/types.xsd`, 982)
  );
  const url = 'http://localhost:50000/Dummy.asmx?wsdl';
  soap.createClient(
    url,
    { httpClient: httpCustomClient },
    (err, client) => {
      assert.ok(client);
      assert.ifError(err);
      assert.equal(client.httpClient, httpCustomClient);
      client.describe();
      assert.deepEqual(client.describe(), {
        DummyService: {
          DummyPortType: {
            Dummy: {
              input: {
                ID: 'IdType|xs:string|pattern',
                Name: 'NameType|xs:string|minLength,maxLength'
              },
              output: {
                Result: 'dummy:DummyList'
              }
            }
          }
        }
      });
      done();
    }
  );
});
