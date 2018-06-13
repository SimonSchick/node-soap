'use strict';

const fs = require('fs');
const soap = require('..');
const assert = require('assert');
const request = require('request');
const http = require('http');
let lastReqAddress;

const test = {};
test.server = null;
test.authenticate = null;
test.authenticateProxy = function authenticate(security, callback) {
  return test.authenticate(security, callback);
};
test.service = {
  StockQuoteService: {
    StockQuotePort: {
      GetLastTradePrice(args, cb, soapHeader) {
        return { price: 19.56 };
      }
    }
  }
};

describe('SOAP Server', () => {
  before(done => {
    fs.readFile(`${__dirname}/wsdl/strict/stockquote.wsdl`, 'utf8', (err, data) => {
      assert.ifError(err);
      test.wsdl = data;
      done();
    });
  });

  beforeEach(done => {
    test.server = http.createServer((req, res) => {
      res.statusCode = 404;
      res.end();
    });

    test.server.listen(15099, null, null, () => {
      test.soapServer = soap.listen(test.server, '/stockquote', test.service, test.wsdl);
      test.soapServer.authenticate = test.authenticateProxy;
      test.baseUrl =
        `http://${test.server.address().address}:${test.server.address().port}`;

      // windows return 0.0.0.0 as address and that is not
      // valid to use in a request
      if (test.server.address().address === '0.0.0.0' || test.server.address().address === '::') {
        test.baseUrl =
          `http://127.0.0.1:${test.server.address().port}`;
      }

      done();
    });
  });

  afterEach(done => {
    test.server.close(() => {
      test.server = null;
      test.authenticate = null;
      delete test.soapServer;
      test.soapServer = null;
      done();
    });
  });

  it('should succeed on valid synchronous authentication', done => {
    test.authenticate = function(security, callback) {
      setTimeout(() => {
        callback(false); // Ignored
      }, 10);
      return true;
    };

    soap.createClient(`${test.baseUrl}/stockquote?wsdl`, (err, client) => {
      assert.ifError(err);

      client.GetLastTradePrice({ tickerSymbol: 'AAPL' }, (err, result) => {
        assert.ifError(err);
        assert.equal(19.56, parseFloat(result.price));
        done();
      });
    });
  });

  it('should succeed on valid asynchronous authentication', done => {
    test.authenticate = function(security, callback) {
      setTimeout(() => {
        callback(true);
      }, 10);
      return null; // Ignored
    };

    soap.createClient(`${test.baseUrl}/stockquote?wsdl`, (err, client) => {
      assert.ifError(err);

      client.GetLastTradePrice({ tickerSymbol: 'AAPL' }, (err, result) => {
        assert.ifError(err);
        assert.equal(19.56, parseFloat(result.price));
        done();
      });
    });
  });

  it('should fail on invalid synchronous authentication', done => {
    test.authenticate = function(security, callback) {
      setTimeout(() => {
        callback(true); // Ignored
      }, 10);
      return false;
    };

    soap.createClient(`${test.baseUrl}/stockquote?wsdl`, (err, client) => {
      assert.ifError(err);

      client.GetLastTradePrice({ tickerSymbol: 'AAPL' }, (err, result) => {
        assert.ok(err);
        assert.ok(err.root.Envelope.Body.Fault.Code.Value);
        assert.equal(err.root.Envelope.Body.Fault.Code.Value, 'SOAP-ENV:Client');
        assert.ok(err.root.Envelope.Body.Fault.Code.Subcode.value);
        assert.equal(err.root.Envelope.Body.Fault.Code.Subcode.value, 'AuthenticationFailure');
        done();
      });
    });
  });

  it('should fail on invalid asynchronous authentication', done => {
    test.authenticate = function(security, callback) {
      setTimeout(() => {
        callback(false);
      }, 10);
    };

    soap.createClient(`${test.baseUrl}/stockquote?wsdl`, (err, client) => {
      assert.ifError(err);

      client.GetLastTradePrice({ tickerSymbol: 'AAPL' }, (err, result) => {
        assert.ok(err);
        assert.ok(err.root.Envelope.Body.Fault.Code.Value);
        assert.equal(err.root.Envelope.Body.Fault.Code.Value, 'SOAP-ENV:Client');
        assert.ok(err.root.Envelope.Body.Fault.Code.Subcode.value);
        assert.equal(err.root.Envelope.Body.Fault.Code.Subcode.value, 'AuthenticationFailure');
        done();
      });
    });
  });
});
