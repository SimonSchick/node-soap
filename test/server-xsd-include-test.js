'use strict';

const fs = require('fs');
const soap = require('..');
const http = require('http');
const assert = require('assert');
const events = require('events');
const finalHandler = require('finalhandler');
const serveStatic = require('serve-static');

const test = {};

test.service = {
  StockQuoteService: {
    StockQuotePort: {
      GetLastTradePrice(args) {
        if (args.tickerSymbol === 'trigger error') {
          throw new Error('triggered server error');
        } else {
          return { price: 19.56 };
        }
      }
    }
  }
};

describe('SOAP Server(XSD include)', () => {
  before(done => {
    fs.readFile(`${__dirname}/wsdl/strict/stockquote-url.wsdl`, 'utf8', (err, data) => {
      assert.ifError(err);
      test.wsdl = data;
      done();
    });
  });

  beforeEach(done => {
    const serve = serveStatic('./test/wsdl/strict');
    test.server = http.createServer((req, res) => {
      const done = finalHandler(req, res);
      serve(req, res, done);
    }).listen(51515, null, null, () => {
      const pathOrOptions = '/stockquote-url';
      test.soapServer = soap.listen(test.server, pathOrOptions, test.service, test.wsdl);

      test.baseUrl = `http://${test.server.address().address}:${test.server.address().port}`;

      if (test.server.address().address === '0.0.0.0' || test.server.address().address === '::') {
        test.baseUrl = `http://127.0.0.1:${test.server.address().port}`;
      }

      assert.ok(test.soapServer);
      done();
    });
  });

  afterEach(done => {
    test.server.close(() => {
      test.server = null;
      delete test.soapServer;
      test.soapServer = null;
      done();
    });
  });


  it('should allow `http` in `schemaLocation` attribute in `xsd:include` tag', done => {
    const url = `${__dirname}/wsdl/strict/stockquote-url.wsdl`;

    soap.createClient(url, (err, client) => {
      assert.ifError(err);
      assert.ok(client);
      done();
    });
  });

});
