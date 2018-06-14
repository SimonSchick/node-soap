'use strict';

const soap = require('..');
const assert = require('assert');

describe('SOAP Client', () => {
  const options = {
    ignoredNamespaces: {
      namespaces: ['ignoreThisNS'],
      override: true
    },
    overrideRootElement: {
      namespace: 'tns'
    },
    overridePromiseSuffix: 'Test',
    request: 'customRequest',
    namespaceArrayElements: true
  };

  it('should set WSDL options to those specified in createClient', done => {
    soap.createClient(`${__dirname}/wsdl/json_response.wsdl`, options, (err, client) => {
      assert.ok(client);
      assert.ifError(err);

      assert.ok(client.wsdl.options.ignoredNamespaces[0] === 'ignoreThisNS');
      assert.ok(client.wsdl.options.overrideRootElement.namespace === 'tns');
      assert.ok(typeof client.MyOperationTest === 'function');
      assert.ok(client.wsdl.options.request, 'customRequest');
      assert.ok(client.wsdl.options.namespaceArrayElements === true);
      done();
    });
  });
});
