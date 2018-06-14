'use strict';

const assert = require('assert');
const fs = require('fs');
const glob = require('glob');
const http = require('http');
const path = require('path');
const timekeeper = require('timekeeper');
const jsdiff = require('diff');
require('colors');
const soap = require('../');
const WSSecurity = require('../lib/security/WSSecurity');
let server;
let port;
const tests = glob.sync('./request-response-samples/*', { cwd: __dirname })
  .map(node => path.resolve(__dirname, node))
  .filter(node => fs.statSync(node).isDirectory());
const suite = {};

function normalizeWhiteSpace(raw) {
  let normalized = raw.replace(/\r\n|\r|\n/g, ''); // strip line endings
  normalized = normalized.replace(/\s\s+/g, ' '); // convert whitespace to spaces
  normalized = normalized.replace(/> </g, '><'); // get rid of spaces between elements
  return normalized;
}

const requestContext = {
  // set these two within each test
  expectedRequest: null,
  responseToSend: null,
  doneHandler: null,
  requestHandler(req, res) {
    const chunks = [];
    req.on('data', chunk => {
      // Ignore eol on sample files.
      chunks.push(chunk.toString().replace(/\r?\n$/m, ''));
    });
    req.on('end', () => {
      if (!requestContext.expectedRequest) {
        res.end(requestContext.responseToSend);
        return;
      }

      const actualRequest = normalizeWhiteSpace(chunks.join(''));
      const expectedRequest = normalizeWhiteSpace(requestContext.expectedRequest);

      if (actualRequest !== expectedRequest) {
        const diff = jsdiff.diffChars(actualRequest, expectedRequest);
        let comparison = '';
        diff.forEach(part => {
          let color = 'grey';
          if (part.added) {
            color = 'green';
          }
          if (part.removed) {
            color = 'red';
          }
          comparison += part.value[color];
        });
        // eslint-disable-next-line
        console.log(comparison);
      }

      assert.equal(actualRequest, expectedRequest);

      if (!requestContext.responseToSend) {
        requestContext.doneHandler();
        return;
      }
      res.end(requestContext.responseToSend);

      requestContext.expectedRequest = null;
      requestContext.responseToSend = null;
    });
  }
};

tests.forEach(test => {
  const nameParts = path.basename(test).split('__');
  const name = nameParts[1].replace(/_/g, ' ');
  const [methodName] = nameParts;
  const wsdl = path.resolve(test, 'soap.wsdl');
  let headerJSON = path.resolve(test, 'header.json');
  let securityJSON = path.resolve(test, 'security.json');
  let requestJSON = path.resolve(test, 'request.json');
  let requestXML = path.resolve(test, 'request.xml');
  let responseJSON = path.resolve(test, 'response.json');
  let responseSoapHeaderJSON = path.resolve(test, 'responseSoapHeader.json');
  const responseJSONError = path.resolve(test, 'error_response.json');
  let responseXML = path.resolve(test, 'response.xml');
  let options = path.resolve(test, 'options.json');
  const wsdlOptionsFile = path.resolve(test, 'wsdl_options.json');
  const wsdlJSOptionsFile = path.resolve(test, 'wsdl_options.js');
  let wsdlOptions = {};

  // headerJSON is optional
  if (fs.existsSync(headerJSON)) {
    headerJSON = require(headerJSON);
  } else {
    headerJSON = {};
  }

  // securityJSON is optional
  if (fs.existsSync(securityJSON)) {
    securityJSON = require(securityJSON);
  } else {
    securityJSON = {};
  }

  // responseJSON is optional
  if (fs.existsSync(responseJSON)) {
    responseJSON = require(responseJSON);
  } else if (fs.existsSync(responseJSONError)) {
    responseJSON = require(responseJSONError);
  } else {
    responseJSON = null;
  }

  // responseSoapHeaderJSON is optional
  if (fs.existsSync(responseSoapHeaderJSON)) {
    responseSoapHeaderJSON = require(responseSoapHeaderJSON);
  } else {
    responseSoapHeaderJSON = null;
  }

  // requestXML is optional
  if (fs.existsSync(requestXML)) {
    requestXML = `${fs.readFileSync(requestXML)}`; } else {
    requestXML = null;
  }

  // responseXML is optional
  if (fs.existsSync(responseXML)) {
    responseXML = `${fs.readFileSync(responseXML)}`;
  } else {
    responseXML = null;
  }

  // requestJSON is required as node-soap will expect a request object anyway
  requestJSON = require(requestJSON);

  // options is optional
  if (fs.existsSync(options)) {
    options = require(options);
  } else {
    options = {};
  }

  // wsdlOptions is optional
  if (fs.existsSync(wsdlOptionsFile)) {
    wsdlOptions = require(wsdlOptionsFile);
  } else if (fs.existsSync(wsdlJSOptionsFile)) {
    wsdlOptions = require(wsdlJSOptionsFile); } else {
    wsdlOptions = {};
  }

  generateTest(name, methodName, wsdl, headerJSON, securityJSON, requestXML, requestJSON, responseXML, responseJSON, responseSoapHeaderJSON, wsdlOptions, options, true);
});

function promiseCaller(client, methodName, requestJSON, responseJSON, responseSoapHeaderJSON) {
  return client[methodName](requestJSON).then(responseArr => {
    const [json, soapHeader] = responseArr;

    if (requestJSON) {
      assert.equal(JSON.stringify(typeof json === 'undefined' ? null : json), JSON.stringify(responseJSON));
      if (responseSoapHeaderJSON) {
        assert.equal(JSON.stringify(soapHeader), JSON.stringify(responseSoapHeaderJSON));
      }
    }
  })
    .catch(err => {
      if (requestJSON) {
        assert.notEqual('undefined: undefined', err.message);
        assert.deepEqual(err.root, responseJSON);
      }
    });
}

function generateTest(name, methodName, wsdlPath, headerJSON, securityJSON, requestXML, requestJSON, responseXML, responseJSON, responseSoapHeaderJSON, wsdlOptions, options) {
  name += ' (promisified)';
  methodName += 'Async';
  const methodCaller = promiseCaller;

  suite[name] = () => {
    if (requestXML) {
      requestContext.expectedRequest = requestXML;
    }
    if (responseXML) {
      requestContext.responseToSend = responseXML;
    }
    return Promise.race([
      soap.createClientAsync(wsdlPath, wsdlOptions, `http://localhost:${port}/Message/Message.dll?Handler=Default`)
        .then(client => {
          if (headerJSON) {
            for (const headerKey in headerJSON) {
              client.addSoapHeader(headerJSON[headerKey], headerKey);
            }
          }
          if (securityJSON && securityJSON.type === 'ws') {
            client.setSecurity(new WSSecurity(securityJSON.username, securityJSON.password, securityJSON.options));
          }

          // Throw more meaningful error
          if (typeof client[methodName] !== 'function') {
            throw new Error(`method ${methodName} does not exists in wsdl specified in test wsdl: ${wsdlPath}`);
          }

          return methodCaller(client, methodName, requestJSON, responseJSON, responseSoapHeaderJSON, options);
        }),
      new Promise((resolve, reject) => {
        requestContext.doneHandler = (err, data) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(data);
        };
      })
    ]);
  };
}

describe('Request Response Sampling', () => {
  const origRandom = Math.random;

  before(done => {
    timekeeper.freeze(Date.parse('2014-10-12T01:02:03Z'));
    Math.random = () => 1;
    server = http.createServer(requestContext.requestHandler);
    server.listen(0, err => {
      if (err) {
        done(err);
        return;
      }
      ({ port } = server.address());
      done();
    });
  });

  beforeEach(() => {
    requestContext.expectedRequest = null;
    requestContext.responseToSend = null;
    requestContext.doneHandler = null;
  });

  after(() => {
    timekeeper.reset();
    Math.random = origRandom;
    server.close();
  });

  Object.keys(suite).forEach(key => {
    it(key, suite[key]);
  });
});
