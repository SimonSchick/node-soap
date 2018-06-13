'use strict';

const fs = require('fs');
const soap = require('..');
const assert = require('assert');

const http = require('http');
const zlib = require('zlib');

const path = 'test/request-response-samples/DefaultNamespace__no_xmlns_prefix_used_for_default_namespace/';

const wsdl = `${path}soap.wsdl`;

const xml = fs.readFileSync(`${path}/soap.wsdl`, 'utf8');
const json = fs.readFileSync(`${path}/request.json`, 'utf8');
const request = fs.readFileSync(`${path}/request.xml`, 'utf8');
const response = fs.readFileSync(`${path}/response.xml`, 'utf8');

const service = {
  MyService: {
    MyServicePort: {
      DefaultNamespace(args) {
        return JSON.parse(json);
      }
    }
  }
};

describe('SOAP Server', () => {
  // This test sends two requests and checks the responses for equality. The
  // first request is sent through a soap client. The second request sends the
  // same request in gzipped format.
  it('should properly handle compression', done => {
    const server = http.createServer();
    let clientResponse;
    let gzipResponse;

    // If both arguments are defined, check if they are equal and exit the test.
    const check = function(a, b) {
      if (a && b) {
        assert(a === b);
        done();
      }
    };

    server.listen(8000);
    server.on('error', done);
    server.on('listening', () => {
      soap.listen(server, '/wsdl', service, xml);

      soap.createClient(wsdl, {
        endpoint: 'http://localhost:8000/wsdl'
      }, (error, client) => {
        assert(!error);
        client.DefaultNamespace(json, (error, response) => {
          console.log(error);
          assert(!error);
          clientResponse = client.lastResponse;
          check(clientResponse, gzipResponse);
        });
      });

      const gzip = zlib.createGzip();

      // Construct a request with the appropriate headers.
      gzip.pipe(http.request({
        host: 'localhost',
        path: '/wsdl',
        port: 8000,
        method: 'POST',
        headers: {
          'content-type': 'text/xml; charset=utf-8',
          'content-encoding': 'gzip',
          soapaction: '"DefaultNamespace"'
        }
      }, res => {
        let body = '';
        res.on('data', data => {
          // Parse the response body.
          body += data;
        });
        res.on('end', () => {
          gzipResponse = body;
          check(clientResponse, gzipResponse);
          // Don't forget to close the server.
          server.close();
        });
      }));

      // Send the request body through the gzip stream to the server.
      gzip.end(request);
    });
  });
});
