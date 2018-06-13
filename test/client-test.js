'use strict';

const fs = require('fs');
const soap = require('..');
const http = require('http');
const assert = require('assert');
const _ = require('lodash');
const sinon = require('sinon');
const wsdl = require('../lib/wsdl');

[
  { suffix: '', options: {} },
  { suffix: ' (with streaming)', options: { stream: true } }
].forEach(meta => {
  describe(`SOAP Client${meta.suffix}`, () => {
    it('should error on invalid host', done => {
      soap.createClient('http://localhost:1', meta.options, (err, client) => {
        assert.ok(err);
        done();
      });
    });

    it('should add and clear soap headers', done => {
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
        assert.ok(client);
        assert.ok(!client.getSoapHeaders());

        const i1 = client.addSoapHeader('about-to-change-1');
        const i2 = client.addSoapHeader('about-to-change-2');

        assert.ok(i1 === 0);
        assert.ok(i2 === 1);
        assert.ok(client.getSoapHeaders().length === 2);

        client.changeSoapHeader(0, 'header1');
        client.changeSoapHeader(1, 'header2');
        assert.ok(client.getSoapHeaders()[0] === 'header1');
        assert.ok(client.getSoapHeaders()[1] === 'header2');

        client.clearSoapHeaders();
        assert.ok(!client.getSoapHeaders());
        done();
      });
    });

    it('should issue async callback for cached wsdl', done => {
      let called = false;
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
        assert.ok(client);
        assert.ifError(err);
        called = true;
        done();
      });
      assert(!called);
    });

    it('should allow customization of httpClient', done => {
      const myHttpClient = {
        request() { }
      };
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`,
        Object.assign({ httpClient: myHttpClient }, meta.options),
        (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          assert.equal(client.httpClient, myHttpClient);
          done();
        });
    });

    it('should allow customization of request for http client', done => {
      const myRequest = function() {
      };
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`,
        Object.assign({ request: myRequest }, meta.options),
        (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          assert.equal(client.httpClient._request, myRequest);
          done();
        });
    });


    it('should allow customization of envelope', done => {
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, Object.assign({ envelopeKey: 'soapenv' }, meta.options), (err, client) => {
        assert.ok(client);
        assert.ifError(err);

        client.MyOperation({}, (err, result) => {
          assert.notEqual(client.lastRequest.indexOf('xmlns:soapenv='), -1);
          done();
        });
      });
    });


    it('should allow passing in XML strings', done => {
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, Object.assign({ envelopeKey: 'soapenv' }, meta.options), (err, client) => {
        assert.ok(client);
        assert.ifError(err);

        const xmlStr = '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n\t<head>\n\t\t<title>404 - Not Found</title>\n\t</head>\n\t<body>\n\t\t<h1>404 - Not Found</h1>\n\t\t<script type="text/javascript" src="http://gp1.wpc.edgecastcdn.net/00222B/beluga/pilot_rtm/beluga_beacon.js"></script>\n\t</body>\n</html>';
        client.MyOperation({ _xml: xmlStr }, (err, result, raw, soapHeader) => {
          assert.ok(err);
          assert.notEqual(raw.indexOf('html'), -1);
          done();
        });
      });
    });

    it('should set binding style to "document" by default if not explicitly set in WSDL, per SOAP spec', done => {
      soap.createClient(`${__dirname}/wsdl/binding_document.wsdl`, meta.options, (err, client) => {
        assert.ok(client);
        assert.ifError(err);

        assert.ok(client.wsdl.definitions.bindings.mySoapBinding.style === 'document');
        done();
      });
    });


    it('should allow disabling the wsdl cache', done => {
      const spy = sinon.spy(wsdl, 'open_wsdl');
      const options = Object.assign({ disableCache: true }, meta.options);
      soap.createClient(`${__dirname}/wsdl/binding_document.wsdl`, options, (err1, client1) => {
        assert.ok(client1);
        assert.ok(!err1);
        soap.createClient(`${__dirname}/wsdl/binding_document.wsdl`, options, (err2, client2) => {
          assert.ok(client2);
          assert.ok(!err2);
          assert.ok(spy.calledTwice);
          wsdl.open_wsdl.restore();
          done();
        });
      });
    });


    describe('Headers in request and last response', () => {
      let server = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      before(done => {
        server = http.createServer((req, res) => {
          const status_value = (req.headers['test-header'] === 'test') ? 'pass' : 'fail';

          res.setHeader('status', status_value);
          res.statusCode = 200;
          res.write(JSON.stringify({ tempResponse: 'temp' }), 'utf8');
          res.end();
        }).listen(port, hostname, done);
      });

      after(done => {
        server.close();
        server = null;
        done();
      });

      it(`should append \`:${port}\` to the Host header on for a request to a service on that port`, done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.notEqual(client.lastRequestHeaders.Host.indexOf(`:${port}`), -1);

            done();
          }, null, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should not append `:80` to the Host header on for a request to a service without a port explicitly defined', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.equal(client.lastRequestHeaders.Host.indexOf(':80'), -1);

            done();
          }, null, { 'test-header': 'test' });
        }, 'http://127.0.0.1');
      });

      it('should not append `:443` to the Host header if endpoints runs on `https`', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, () => {
            assert.equal(client.lastRequestHeaders.Host.indexOf(':443'), -1);
            done();
          }, null, { 'test-header': 'test' });
        }, 'https://127.0.0.1');
      });

      it('should append a port to the Host header if explicitly defined', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, () => {
            assert.ok(client.lastRequestHeaders.Host.indexOf(':443') > -1);
            done();
          }, null, { 'test-header': 'test' });
        }, 'https://127.0.0.1:443');
      });


      it('should have xml request modified', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.ok(result);
            assert.ok(client.lastResponse);
            assert.ok(client.lastResponseHeaders);

            done();
          }, {
            postProcess(_xml) {
              return _xml.replace('soap', 'SOAP');
            }
          }
          );
        }, baseUrl);
      });

      it('should have the correct extra header in the request', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.ok(result);
            assert.ok(client.lastResponseHeaders);
            assert.equal(client.lastResponseHeaders.status, 'pass');

            done();
          }, null, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should have the wrong extra header in the request', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.ok(result);
            assert.ok(client.lastResponseHeaders);
            assert.equal(client.lastResponseHeaders.status, 'fail');

            done();
          }, null, { 'test-header': 'testBad' });
        }, baseUrl);
      });

      it('should have lastResponse and lastResponseHeaders after the call', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.ok(result);
            assert.ok(client.lastResponse);
            assert.ok(client.lastResponseHeaders);

            done();
          }, null, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should have rawRequest available in the callback', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result, rawResponse, headers, rawRequest) => {
            assert.ok(rawRequest);
            assert.ok(typeof rawRequest === 'string');

            done();
          }, null, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should have lastElapsedTime after a call with the time option passed', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.ok(result);
            assert.ok(client.lastResponse);
            assert.ok(client.lastResponseHeaders);
            assert.ok(client.lastElapsedTime);

            done();
          }, { time: true }, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should add http headers in method call options', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.ok(result);
            assert.ok(client.lastRequestHeaders['test-header']);
            assert.ok(client.lastRequestHeaders['options-test-header']);

            done();
          }, { headers: { 'options-test-header': 'test' } }, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should not return error in the call and return the json in body', done => {
        soap.createClient(`${__dirname}/wsdl/json_response.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result, body) => {
            assert.ok(result);
            assert.ifError(err);
            assert.ok(body);
            done();
          }, null, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should add proper headers for soap12', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace_soap12.wsdl`, Object.assign({ forceSoap12Headers: true }, meta.options), (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result) => {
            assert.ok(result);
            assert.ok(client.lastRequestHeaders);
            assert.ok(client.lastRequest);
            assert.equal(client.lastRequestHeaders['Content-Type'], 'application/soap+xml; charset=utf-8');
            assert.notEqual(client.lastRequest.indexOf('xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\"'), -1);
            assert(!client.lastRequestHeaders.SOAPAction);
            done();
          }, null, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should allow calling the method with args, callback, options and extra headers', done => {
        soap.createClient(`${__dirname}/wsdl/json_response.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result, body) => {
            assert.ifError(err);
            assert.ok(result);
            assert.ok(body.tempResponse === 'temp');
            assert.ok(client.lastResponseHeaders.status === 'pass');
            assert.ok(client.lastRequestHeaders['options-test-header'] === 'test');

            done();
          }, { headers: { 'options-test-header': 'test' } }, { 'test-header': 'test' });
        }, baseUrl);
      });

      it('should allow calling the method with only a callback', done => {
        soap.createClient(`${__dirname}/wsdl/json_response.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation((err, result, body) => {
            assert.ifError(err);
            assert.ok(result);
            assert.ok(body.tempResponse === 'temp');
            assert.ok(client.lastResponseHeaders.status === 'fail');

            done();
          });
        }, baseUrl);
      });

      it('should allow calling the method with args, options and callback last', done => {
        soap.createClient(`${__dirname}/wsdl/json_response.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, { headers: { 'options-test-header': 'test' } }, (err, result, body) => {
            assert.ifError(err);
            assert.ok(result);
            assert.ok(body.tempResponse === 'temp');
            assert.ok(client.lastResponseHeaders.status === 'fail');
            assert.ok(client.lastRequestHeaders['options-test-header'] === 'test');

            done();
          });
        }, baseUrl);
      });

      it('should allow calling the method with args, options, extra headers and callback last', done => {
        soap.createClient(`${__dirname}/wsdl/json_response.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, { headers: { 'options-test-header': 'test' } }, { 'test-header': 'test' }, (err, result, body) => {
            assert.ifError(err);
            assert.ok(result);
            assert.ok(body.tempResponse === 'temp');
            assert.ok(client.lastResponseHeaders.status === 'pass');
            assert.ok(client.lastRequestHeaders['options-test-header'] === 'test');

            done();
          });
        }, baseUrl);
      });
    });

    it('should add soap headers', done => {
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
        assert.ok(client);
        assert.ok(!client.getSoapHeaders());
        const soapheader = {
          esnext: false,
          moz: true,
          boss: true,
          node: true,
          validthis: true,
          globals: {
            EventEmitter: true,
            Promise: true
          }
        };

        client.addSoapHeader(soapheader);

        assert.ok(client.getSoapHeaders()[0] === '<esnext>false</esnext><moz>true</moz><boss>true</boss><node>true</node><validthis>true</validthis><globals><EventEmitter>true</EventEmitter><Promise>true</Promise></globals>');
        done();
      });
    });

    it('should add soap headers with a namespace', done => {
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
        assert.ok(client);
        assert.ok(!client.getSoapHeaders());

        client.addSoapHeader({ header1: 'content' }, null, null, 'http://example.com');

        assert.ok(client.getSoapHeaders().length === 1);
        assert.ok(client.getSoapHeaders()[0] === '<header1 xmlns="http://example.com">content</header1>');

        client.clearSoapHeaders();
        assert.ok(!client.getSoapHeaders());
        done();
      });
    });

    it('should add http headers', done => {
      soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
        assert.ok(client);
        assert.ok(!client.getHttpHeaders());

        client.addHttpHeader('foo', 'bar');

        assert.ok(client.getHttpHeaders());
        assert.equal(client.getHttpHeaders().foo, 'bar');

        client.clearHttpHeaders();
        assert.equal(Object.keys(client.getHttpHeaders()).length, 0);
        done();
      });
    });

    describe('Namespace number', () => {
      let server = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      before(done => {
        server = http.createServer((req, res) => {
          res.statusCode = 200;
          res.write(JSON.stringify({ tempResponse: 'temp' }), 'utf8');
          res.end();
        }).listen(port, hostname, done);
      });

      after(done => {
        server.close();
        server = null;
        done();
      });

      it('should reset the namespace number', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          assert.ok(client);

          const data = {
            attributes: {
              xsi_type: {
                type: 'Ty',
                xmlns: 'xmlnsTy'
              }
            }
          };

          const message = '<Request xsi:type="ns1:Ty" xmlns:ns1="xmlnsTy" xmlns="http://www.example.com/v1"></Request>';
          client.MyOperation(data, (err, result) => {
            assert.ok(client.lastRequest);
            assert.ok(client.lastMessage);
            assert.ok(client.lastEndpoint);
            assert.equal(client.lastMessage, message);

            delete data.attributes.xsi_type.namespace;
            client.MyOperation(data, (err, result) => {
              assert.ok(client.lastRequest);
              assert.ok(client.lastMessage);
              assert.ok(client.lastEndpoint);
              assert.equal(client.lastMessage, message);

              done();
            });
          });
        }, baseUrl);
      });
    });

    describe('Follow even non-standard redirects', () => {
      let server1 = null;
      let server2 = null;
      let server3 = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      before(done => {
        server1 = http.createServer((req, res) => {
          res.statusCode = 301;
          res.setHeader('Location', `http://${hostname}:${port + 1}`);
          res.end();
        }).listen(port, hostname, () => {
          server2 = http.createServer((req, res) => {
            res.statusCode = 302;
            res.setHeader('Location', `http://${hostname}:${port + 2}`);
            res.end();
          }).listen((port + 1), hostname, () => {
            server3 = http.createServer((req, res) => {
              res.statusCode = 401;
              res.write(JSON.stringify({ tempResponse: 'temp' }), 'utf8');
              res.end();
            }).listen((port + 2), hostname, done);
          });
        });
      });

      after(done => {
        server1.close();
        server2.close();
        server3.close();
        server1 = null;
        server2 = null;
        server3 = null;
        done();
      });

      it('should return an error', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          client.MyOperation({}, (err, result) => {
            assert.ok(err);
            assert.ok(err.response);
            assert.equal(err.body, '{"tempResponse":"temp"}');
            done();
          });
        }, baseUrl);
      });
    });

    describe('Handle non-success http status codes', () => {
      let server = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      before(done => {
        server = http.createServer((req, res) => {
          res.statusCode = 401;
          res.write(JSON.stringify({ tempResponse: 'temp' }), 'utf8');
          res.end();
        }).listen(port, hostname, done);
      });

      after(done => {
        server.close();
        server = null;
        done();
      });

      it('should return an error', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          client.MyOperation({}, (err, result) => {
            assert.ok(err);
            assert.ok(err.response);
            assert.ok(err.body);
            done();
          });
        }, baseUrl);
      });

      it('should emit a \'soapError\' event', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          client.on('soapError', err => {
            assert.ok(err);
          });
          client.MyOperation({}, (err, result) => {
            done();
          });
        }, baseUrl);
      });
    });

    describe('Handle HTML answer from non-SOAP server', () => {
      let server = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      before(done => {
        server = http.createServer((req, res) => {
          res.statusCode = 200;
          res.write('<html><body></body></html>', 'utf8');
          res.end();
        }).listen(port, hostname, done);
      });

      after(done => {
        server.close();
        server = null;
        done();
      });

      it('should return an error', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          client.MyOperation({}, (err, result) => {
            assert.ok(err);
            assert.ok(err.response);
            assert.ok(err.body);
            done();
          });
        }, baseUrl);
      });
    });

    describe('Client Events', () => {
      let server = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      before(done => {
        server = http.createServer((req, res) => {
          res.statusCode = 200;
          fs.createReadStream(`${__dirname}/soap-failure.xml`).pipe(res);
        }).listen(port, hostname, done);
      });

      after(done => {
        server.close();
        server = null;
        done();
      });


      it('Should emit the "message" event with Soap Body string and an exchange id', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          let didEmitEvent = false;
          client.on('message', (xml, eid) => {
            didEmitEvent = true;
            // Should contain only message body
            assert.equal(typeof xml, 'string');
            assert.equal(xml.indexOf('soap:Envelope'), -1);
            assert.ok(eid);
          });

          client.MyOperation({}, () => {
            assert.ok(didEmitEvent);
            done();
          });
        }, baseUrl);
      });

      it('Should emit the "request" event with entire XML message and an exchange id', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          let didEmitEvent = false;
          client.on('request', (xml, eid) => {
            didEmitEvent = true;
            // Should contain entire soap message
            assert.equal(typeof xml, 'string');
            assert.notEqual(xml.indexOf('soap:Envelope'), -1);
            assert.ok(eid);
          });

          client.MyOperation({}, () => {
            assert.ok(didEmitEvent);
            done();
          });
        }, baseUrl);
      });

      it('Should emit the "response" event with Soap Body string and Response object and an exchange id', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          let didEmitEvent = false;
          client.on('response', (xml, response, eid) => {
            didEmitEvent = true;
            // Should contain entire soap message
            assert.equal(typeof xml, 'string');
            assert.equal(xml.indexOf('soap:Envelope'), -1);
            assert.ok(response);
            assert.ok(eid);
          });

          client.MyOperation({}, () => {
            assert.ok(didEmitEvent);
            done();
          });
        }, baseUrl);
      });

      it('Should emit the "request" and "response" events with the same generated exchange id if none is given', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          let didEmitRequestEvent = false;
          let didEmitResponseEvent = false;
          let requestEid;
          let responseEid;

          client.on('request', (xml, eid) => {
            didEmitRequestEvent = true;
            requestEid = eid;
            assert.ok(eid);
          });

          client.on('response', (xml, response, eid) => {
            didEmitResponseEvent = true;
            responseEid = eid;
            assert.ok(eid);
          });

          client.MyOperation({}, () => {
            assert.ok(didEmitRequestEvent);
            assert.ok(didEmitResponseEvent);
            assert.equal(responseEid, requestEid);
            done();
          });
        }, baseUrl);
      });

      it('Should emit the "request" and "response" events with the given exchange id', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          let didEmitRequestEvent = false;
          let didEmitResponseEvent = false;
          let requestEid;
          let responseEid;

          client.on('request', (xml, eid) => {
            didEmitRequestEvent = true;
            requestEid = eid;
            assert.ok(eid);
          });

          client.on('response', (xml, response, eid) => {
            didEmitResponseEvent = true;
            responseEid = eid;
            assert.ok(eid);
          });

          client.MyOperation({}, () => {
            assert.ok(didEmitRequestEvent);
            assert.ok(didEmitResponseEvent);
            assert.equal('unit', requestEid);
            assert.equal(responseEid, requestEid);
            done();
          }, { exchangeId : 'unit' });
        }, baseUrl);
      });

      it('should emit a \'soapError\' event with an exchange id', done => {
        soap.createClient(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options, (err, client) => {
          let didEmitEvent = false;
          client.on('soapError', (err, eid) => {
            didEmitEvent = true;
            assert.ok(err.root.Envelope.Body.Fault);
            assert.ok(eid);
          });
          client.MyOperation({}, (err, result) => {
            assert.ok(didEmitEvent);
            done();
          });
        }, baseUrl);
      });

    });

    it('should return error in the call when Fault was returned', done => {
      let server = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      server = http.createServer((req, res) => {
        res.statusCode = 200;
        res.write('<?xml version="1.0" encoding="ISO-8859-1"?><SOAP-ENV:Envelope SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"\n  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"\n  xmlns:xsd="http://www.w3.org/2001/XMLSchema"\n  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/">\n<SOAP-ENV:Body><SOAP-ENV:Fault><faultcode xsi:type="xsd:string">Test</faultcode><faultactor xsi:type="xsd:string"></faultactor><faultstring xsi:type="xsd:string">test error</faultstring><detail xsi:type="xsd:string">test detail</detail></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>');
        res.end();
      }).listen(port, hostname, () => {
        soap.createClient(`${__dirname}/wsdl/json_response.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result, body) => {
            server.close();
            server = null;
            assert.ok(err);
            assert.strictEqual(err.message, 'Test: test error: test detail');
            assert.ok(result);
            assert.ok(body);
            done();
          });
        }, baseUrl);
      });

    });

    it('should return error in the call when Body was returned empty', done => {
      let server = null;
      const hostname = '127.0.0.1';
      const port = 15099;
      const baseUrl = `http://${hostname}:${port}`;

      server = http.createServer((req, res) => {
        res.statusCode = 200;
        res.write('<soapenv:Envelope xmlns:soapenv=\'http://schemas.xmlsoap.org/soap/envelope/\'><soapenv:Body/></soapenv:Envelope>');
        res.end();
      }).listen(port, hostname, () => {
        soap.createClient(`${__dirname}/wsdl/empty_body.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);

          client.MyOperation({}, (err, result, body, responseSoapHeaders) => {
            server.close();
            server = null;
            assert.ifError(err);
            assert.ok(!responseSoapHeaders);
            assert.ok(result);
            assert.ok(body);
            done();
          });
        }, baseUrl);
      });
    });

    describe('Method invocation', () => {

      it('shall generate correct payload for methods with string parameter', done => {
        // Mock the http post function in order to easy be able to validate the
        // generated payload
        const stringParameterValue = 'MY_STRING_PARAMETER_VALUE';
        const expectedSoapBody = `<sstringElement xmlns="http://www.BuiltinTypes.com/">${
          stringParameterValue
        }</sstringElement>`;
        let request = null;
        const mockRequestHandler = function(_request) {
          request = _request;
          return {
            on() { }
          };
        };
        const options = Object.assign({
          request: mockRequestHandler,
        }, meta.options);
        soap.createClient(`${__dirname}/wsdl/builtin_types.wsdl`, options, (err, client) => {
          assert.ok(client);

          // Call the method
          client.StringOperation(stringParameterValue);

          // Analyse and validate the generated soap body
          const requestBody = request.body;
          const [, soapBody] = requestBody.match(/<soap:Body>(.*)<\/soap:Body>/);
          assert.ok(soapBody === expectedSoapBody);
          done();
        });
      });

      it('shall generate correct payload for methods with array parameter', done => {
        soap.createClient(`${__dirname}/wsdl/list_parameter.wsdl`, (err, client) => {
          assert.ok(client);
          const pathToArrayContainer = 'TimesheetV201511Mobile.TimesheetV201511MobileSoap.AddTimesheet.input.input.PeriodList';
          const arrayParameter = _.get(client.describe(), pathToArrayContainer)['PeriodType[]'];
          assert.ok(arrayParameter);
          client.AddTimesheet({ input: { PeriodList: { PeriodType: [{ PeriodId: '1' }] } } }, () => {
            const sentInputContent = client.lastRequest.substring(client.lastRequest.indexOf('<input>') + '<input>'.length, client.lastRequest.indexOf('</input>'));
            assert.equal(sentInputContent, '<PeriodList><PeriodType><PeriodId>1</PeriodId></PeriodType></PeriodList>');
            done();
          });
        });
      });

      it('shall generate correct payload for methods with array parameter when individual array elements are not namespaced', done => {
        // used for servers that cannot aggregate individually namespaced array elements
        soap.createClient(`${__dirname}/wsdl/list_parameter.wsdl`, { disableCache: true, namespaceArrayElements: false }, (err, client) => {
          assert.ok(client);
          const pathToArrayContainer = 'TimesheetV201511Mobile.TimesheetV201511MobileSoap.AddTimesheet.input.input.PeriodList';
          const arrayParameter = _.get(client.describe(), pathToArrayContainer)['PeriodType[]'];
          assert.ok(arrayParameter);
          client.AddTimesheet({ input: { PeriodList: { PeriodType: [{ PeriodId: '1' }, { PeriodId: '2' }] } } }, () => {
            const sentInputContent = client.lastRequest.substring(client.lastRequest.indexOf('<input>') + '<input>'.length, client.lastRequest.indexOf('</input>'));
            assert.equal(sentInputContent, '<PeriodList><PeriodType><PeriodId>1</PeriodId><PeriodId>2</PeriodId></PeriodType></PeriodList>');
            done();
          });
        });
      });

      it('shall generate correct payload for methods with array parameter when individual array elements are namespaced', done => {
        // this is the default behavior for array element namespacing
        soap.createClient(`${__dirname}/wsdl/list_parameter.wsdl`, { disableCache: true, namespaceArrayElements: true }, (err, client) => {
          assert.ok(client);
          assert.ok(client.wsdl.options.namespaceArrayElements === true);
          const pathToArrayContainer = 'TimesheetV201511Mobile.TimesheetV201511MobileSoap.AddTimesheet.input.input.PeriodList';
          const arrayParameter = _.get(client.describe(), pathToArrayContainer)['PeriodType[]'];
          assert.ok(arrayParameter);
          client.AddTimesheet({ input: { PeriodList: { PeriodType: [{ PeriodId: '1' }, { PeriodId: '2' }] } } }, () => {
            const sentInputContent = client.lastRequest.substring(client.lastRequest.indexOf('<input>') + '<input>'.length, client.lastRequest.indexOf('</input>'));
            assert.equal(sentInputContent, '<PeriodList><PeriodType><PeriodId>1</PeriodId></PeriodType><PeriodType><PeriodId>2</PeriodId></PeriodType></PeriodList>');
            done();
          });
        });
      });

      it('shall generate correct payload for recursively-defined types', done => {
        soap.createClient(`${__dirname}/wsdl/recursive2.wsdl`, (err, client) => {
          if (err) {
            return void done(err);
          }

          assert.ok(client);
          client.AddAttribute({
            Requests:{
              AddAttributeRequest:[
                {
                  RequestIdx:1,
                  Identifier:{
                    SystemNamespace:'bugrepro',
                    ResellerId:1,
                    CustomerNum:'860692',
                    AccountUid:'80a6e559-4d65-11e7-bd5b-0050569a12d7'
                  },
                  Attr:{
                    AttributeId:716,
                    IsTemplateAttribute:0,
                    ReadOnly:0,
                    CanBeModified:1,
                    Name:'domain',
                    AccountElements:{
                      AccountElement:[
                        {
                          ElementId:1693,
                          Name:'domain',
                          Value:'foo',
                          ReadOnly:0,
                          CanBeModified:1
                        }
                      ]
                    }
                  },
                  RequestedBy:'blah',
                  RequestedByLogin:'system'
                }
              ]
            }
          }, () => {
            const sentInputContent = client.lastRequest.substring(client.lastRequest.indexOf('<Requests>') + '<Requests>'.length, client.lastRequest.indexOf('</Requests>'));
            assert.equal(
              sentInputContent,
              '<AddAttributeRequest><RequestIdx>1</RequestIdx><Identifier><SystemNamespace>bugrepro</SystemNamespace><ResellerId>1</ResellerId><CustomerNum>860692</CustomerNum><AccountUid>80a6e559-4d65-11e7-bd5b-0050569a12d7</AccountUid></Identifier><Attr><AttributeId>716</AttributeId><IsTemplateAttribute>0</IsTemplateAttribute><ReadOnly>0</ReadOnly><CanBeModified>1</CanBeModified><Name>domain</Name><AccountElements><AccountElement><ElementId>1693</ElementId><Name>domain</Name><Value>foo</Value><ReadOnly>0</ReadOnly><CanBeModified>1</CanBeModified></AccountElement></AccountElements></Attr><RequestedBy>blah</RequestedBy><RequestedByLogin>system</RequestedByLogin></AddAttributeRequest>');
            done();
          });
        });
      });
    });

    describe('Client created with createClientAsync', () => {
      it('should error on invalid host', done => {
        soap.createClientAsync('http://localhost:1', meta.options)
          .then(client => {})
          .catch(err => {
            assert.ok(err);
            done();
          });
      });

      it('should add and clear soap headers', done => {
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options).then(client => {
          assert.ok(client);
          assert.ok(!client.getSoapHeaders());

          const i1 = client.addSoapHeader('about-to-change-1');
          const i2 = client.addSoapHeader('about-to-change-2');

          assert.ok(i1 === 0);
          assert.ok(i2 === 1);
          assert.ok(client.getSoapHeaders().length === 2);

          client.changeSoapHeader(0, 'header1');
          client.changeSoapHeader(1, 'header2');
          assert.ok(client.getSoapHeaders()[0] === 'header1');
          assert.ok(client.getSoapHeaders()[1] === 'header2');

          client.clearSoapHeaders();
          assert.ok(!client.getSoapHeaders());
          done();
        });
      });

      it('should issue async promise for cached wsdl', done => {
        let called = false;
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options).then(client => {
          assert.ok(client);
          called = true;
          done();
        });
        assert(!called);
      });

      it('should allow customization of httpClient', done => {
        const myHttpClient = {
          request() { }
        };
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`,
          Object.assign({ httpClient: myHttpClient }, meta.options))
          .then(client => {
            assert.ok(client);
            assert.equal(client.httpClient, myHttpClient);
            done();
          });
      });

      it('should allow customization of request for http client', done => {
        const myRequest = function() {
        };
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`,
          Object.assign({ request: myRequest }, meta.options))
          .then(client => {
            assert.ok(client);
            assert.equal(client.httpClient._request, myRequest);
            done();
          });
      });

      it('should set binding style to "document" by default if not explicitly set in WSDL, per SOAP spec', done => {
        soap.createClientAsync(`${__dirname}/wsdl/binding_document.wsdl`, meta.options)
          .then(client => {
            assert.ok(client);
            assert.ok(client.wsdl.definitions.bindings.mySoapBinding.style === 'document');
            done();
          });
      });

      it('should allow passing in XML strings', done => {
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`, Object.assign({ envelopeKey: 'soapenv' }, meta.options))
          .then(client => {
            assert.ok(client);
            const xmlStr = '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">\n\t<head>\n\t\t<title>404 - Not Found</title>\n\t</head>\n\t<body>\n\t\t<h1>404 - Not Found</h1>\n\t\t<script type="text/javascript" src="http://gp1.wpc.edgecastcdn.net/00222B/beluga/pilot_rtm/beluga_beacon.js"></script>\n\t</body>\n</html>';
            return client.MyOperationAsync({ _xml: xmlStr });
          })
          .spread((result, raw, soapHeader) => {})
          .catch(err => {
            done();
          });
      });

      it('should allow customization of envelope', done => {
        let client;
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`, Object.assign({ envelopeKey: 'soapenv' }, meta.options))
          .then(createdClient => {
            assert.ok(createdClient);
            client = createdClient;
            return client.MyOperationAsync({});
          })
          .then(response => {})
          .catch(err => {
            assert.notEqual(client.lastRequest.indexOf('xmlns:soapenv='), -1);
            done();
          });
      });

      it('should add soap headers', done => {
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options)
          .then(client => {
            assert.ok(client);
            assert.ok(!client.getSoapHeaders());
            const soapheader = {
              esnext: false,
              moz: true,
              boss: true,
              node: true,
              validthis: true,
              globals: {
                EventEmitter: true,
                Promise: true
              }
            };

            client.addSoapHeader(soapheader);

            assert.ok(client.getSoapHeaders()[0] === '<esnext>false</esnext><moz>true</moz><boss>true</boss><node>true</node><validthis>true</validthis><globals><EventEmitter>true</EventEmitter><Promise>true</Promise></globals>');
            done();
          });
      });

      it('should allow disabling the wsdl cache', done => {
        const spy = sinon.spy(wsdl, 'open_wsdl');
        const options = Object.assign({ disableCache: true }, meta.options);
        soap.createClientAsync(`${__dirname}/wsdl/binding_document.wsdl`, options)
          .then(client => {
            assert.ok(client);
            return soap.createClientAsync(`${__dirname}/wsdl/binding_document.wsdl`, options);
          })
          .then(client => {
            assert.ok(client);
            assert.ok(spy.calledTwice);
            wsdl.open_wsdl.restore();
            done();
          });
      });

      it('should add http headers', done => {
        soap.createClientAsync(`${__dirname}/wsdl/default_namespace.wsdl`, meta.options)
          .then(client => {
            assert.ok(client);
            assert.ok(!client.getHttpHeaders());

            client.addHttpHeader('foo', 'bar');

            assert.ok(client.getHttpHeaders());
            assert.equal(client.getHttpHeaders().foo, 'bar');

            client.clearHttpHeaders();
            assert.equal(Object.keys(client.getHttpHeaders()).length, 0);
            done();
          });
      });

    });

    describe('Client created with option normalizeNames', () => {

      it('should create node-style method with normalized name (a valid Javascript identifier)', done => {
        soap.createClient(`${__dirname}/wsdl/non_identifier_chars_in_operation.wsdl`, Object.assign({ normalizeNames: true }, meta.options), (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          client.prefixed_MyOperation({}, (err, result) => {
            // only need to check that a valid request is generated, response isn't needed
            assert.ok(client.lastRequest);
            done();
          });
        });
      });

      it('should create node-style method with non-normalized name on Client.service.port.method style invocation', done => {
        soap.createClient(`${__dirname}/wsdl/non_identifier_chars_in_operation.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          /* jshint -W069 */
          assert.throws(() => {client.MyService.MyServicePort['prefixed_MyOperation']({});}, TypeError);
          /* jshint +W069 */
          client.MyService.MyServicePort['prefixed-MyOperation']({}, (err, result) => {
            // only need to check that a valid request is generated, response isn't needed
            assert.ok(client.lastRequest);
            done();
          });
        });
      });

      it('should create promise-style method with normalized name (a valid Javascript identifier)', done => {
        soap.createClient(`${__dirname}/wsdl/non_identifier_chars_in_operation.wsdl`, Object.assign({ normalizeNames: true }, meta.options), (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          client.prefixed_MyOperationAsync({})
            .then(result => {})
            .catch(err => {
              // only need to check that a valid request is generated, response isn't needed
              assert.ok(client.lastRequest);
              done();
            });
        });
      });

      it('should not create methods with invalid Javascript identifier', done => {
        soap.createClient(`${__dirname}/wsdl/non_identifier_chars_in_operation.wsdl`, Object.assign({ normalizeNames: true }, meta.options), (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          assert.throws(() => {client['prefixed-MyOperationAsync']({});}, TypeError);
          assert.throws(() => {client['prefixed-MyOperation']({});}, TypeError);
          done();
        });
      });

      it('should create node-style method with invalid Javascript identifier if option normalizeNames is not used', done => {
        soap.createClient(`${__dirname}/wsdl/non_identifier_chars_in_operation.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          client['prefixed-MyOperation']({}, (err, result) => {
            // only need to check that a valid request is generated, response isn't needed
            assert.ok(client.lastRequest);
            done();
          });
        });
      });

      it('does not create a promise-style method with invalid Javascript identifier if option normalizeNames is not used', done => {
        soap.createClient(`${__dirname}/wsdl/non_identifier_chars_in_operation.wsdl`, meta.options, (err, client) => {
          assert.ok(client);
          assert.ifError(err);
          assert.throws(() => {client['prefixed-MyOperationAsync']({});}, TypeError);
          done();
        });
      });
    });
  });
});
