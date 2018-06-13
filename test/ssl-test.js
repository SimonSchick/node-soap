'use strict';

const fs = require('fs');
const soap = require('..');
const https = require('https');
const constants = require('constants');
const assert = require('assert');

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

test.sslOptions = {
  key: fs.readFileSync(`${__dirname}/certs/agent2-key.pem`),
  cert: fs.readFileSync(`${__dirname}/certs/agent2-cert.pem`)
};

describe('SOAP Client(SSL)', () => {
  before(done => {
    fs.readFile(`${__dirname}/wsdl/strict/stockquote.wsdl`, 'utf8', (err, data) => {
      assert.ifError(err);
      test.wsdl = data;
      done();
    });
  });

  beforeEach(done => {
    test.server = https.createServer(test.sslOptions, (req, res) => {
      res.statusCode = 404;
      res.end();
    }).listen(51515, () => {
      test.soapServer = soap.listen(test.server, '/stockquote', test.service, test.wsdl);
      test.baseUrl =
        `https://${test.server.address().address}:${test.server.address().port}`;

      if (test.server.address().address === '0.0.0.0' || test.server.address().address === '::') {
        test.baseUrl =
          `https://127.0.0.1:${test.server.address().port}`;
      }
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

  it('should connect to an SSL server', done => {
    soap.createClient(`${__dirname}/wsdl/strict/stockquote.wsdl`, (err, client) => {
      assert.ifError(err);
      client.setEndpoint(`${test.baseUrl}/stockquote`);
      client.setSecurity({
        addOptions(options){
          options.cert = test.sslOptions.cert,
          options.key = test.sslOptions.key,
          options.rejectUnauthorized = false;
          options.secureOptions = constants.SSL_OP_NO_TLSv1_2;
          options.strictSSL = false;
          options.agent = new https.Agent(options);
        },
        toXML() { return ''; }
      });

      client.GetLastTradePrice({ tickerSymbol: 'AAPL' }, (err, result) => {
        assert.ifError(err);
        assert.equal(19.56, parseFloat(result.price));
        done();
      });
    });
  });

});
