'use strict';

const fs = require('fs');
const soap = require('..');
const assert = require('assert');
const sinon = require('sinon');

const wsdlStrictTests = {};
const wsdlNonStrictTests = {};

fs.readdirSync(`${__dirname}/wsdl/strict`).forEach(file => {
  if (!/.wsdl$/.exec(file)) {
    return;
  }
  wsdlStrictTests[`should parse and describe ${file}`] = done => {
    soap.createClient(`${__dirname}/wsdl/strict/${file}`, { strict: true }, (err, client) => {
      assert.ifError(err);
      client.describe();
      done();
    });
  };
});

fs.readdirSync(`${__dirname}/wsdl`).forEach(file => {
  if (!/.wsdl$/.exec(file)) {
    return;
  }
  wsdlNonStrictTests[`should parse and describe ${file}`] = done => {
    soap.createClient(`${__dirname}/wsdl/${file}`, (err, client) => {
      assert.ifError(err);
      client.describe();
      done();
    });
  };
});

wsdlNonStrictTests['should not parse connection error'] = done => {
  soap.createClient(`${__dirname}/wsdl/connection/econnrefused.wsdl`, err => {
    assert.ok(/EADDRNOTAVAIL|ECONNREFUSED/.test(err), err);
    done();
  });
};

wsdlNonStrictTests['should catch parse error'] = done => {
  soap.createClient(`${__dirname}/wsdl/bad.txt`, err => {
    assert.notEqual(err, null);
    done();
  });
};

wsdlStrictTests['should catch parse error'] = done => {
  soap.createClient(`${__dirname}/wsdl/bad.txt`, { strict: true }, err => {
    assert.notEqual(err, null);
    done();
  });
};

wsdlStrictTests['should parse external wsdl'] = done => {
  soap.createClient(`${__dirname}/wsdl/wsdlImport/main.wsdl`, { strict: true }, (err, client) => {
    assert.ifError(err);
    assert.deepEqual(
      Object.keys(client.wsdl.definitions.schemas),
      ['http://example.com/', 'http://schemas.microsoft.com/2003/10/Serialization/Arrays']
    );
    assert.equal(typeof client.getLatestVersion, 'function');
    done();
  });
};

wsdlStrictTests['should get the parent namespace when parent namespace is empty string'] = done => {
  soap.createClient(`${__dirname}/wsdl/marketo.wsdl`, { strict: true }, (err, client) => {
    assert.ifError(err);
    client.getLeadChanges({
      batchSize: 1,
      startPosition: { activityCreatedAt: '2014-04-14T22:03:48.587Z' },
      activityNameFilter: { stringItem: ['Send Email'] }
    }, () => {
      done();
    });
  });
};

wsdlStrictTests['should describe extended elements in correct order'] = done => {
  const expected = '{"DummyService":{"DummyPortType":{"Dummy":{"input":{"DummyRequest":{"DummyField1":"xs:string","DummyField2":"xs:string"},"ExtendedDummyField":"xs:string"},"output":{"DummyResult":"c:DummyResult"}}}}}';
  soap.createClient(`${__dirname}/wsdl/extended_element.wsdl`, (err, client) => {
    assert.ifError(err);
    assert.equal(JSON.stringify(client.describe()), expected);
    done();
  });
};

wsdlStrictTests['should handle element ref'] = done => {
  const expectedMsg = '<ns1:fooRq xmlns:ns1="http://example.com/bar/xsd"' +
    ' xmlns="http://example.com/bar/xsd"><bar1:paymentRq' +
    ' xmlns:bar1="http://example.com/bar1/xsd">' +
    '<bar1:bankSvcRq>' +
    '<bar1:requestUID>001</bar1:requestUID></bar1:bankSvcRq>' +
    '</bar1:paymentRq></ns1:fooRq>';
  soap.createClient(`${__dirname}/wsdl/elementref/foo.wsdl`, { strict: true }, (err, client) => {
    assert.ifError(err);
    client.fooOp({ paymentRq: { bankSvcRq: { requestUID: '001' } } }, err => {
      assert.ifError(err);
      assert.equal(client.lastMessage, expectedMsg);
      done();
    });
  });
};

wsdlStrictTests['should handle type ref'] = done => {
  const expectedMsg = require('./wsdl/typeref/request.xml.js');
  const reqJson = require('./wsdl/typeref/request.json');
  soap.createClient(`${__dirname}/wsdl/typeref/order.wsdl`, { strict: true }, (err, client) => {
    assert.ifError(err);
    client.order(reqJson, err => {
      assert.ifError(err);
      assert.equal(client.lastMessage, expectedMsg);
      done();
    });
  });
};

wsdlStrictTests['should parse POJO into xml without making unnecessary recursion'] = done => {
  const expectedMsg = require('./wsdl/perf/request.xml.js');
  const reqJson = require('./wsdl/perf/request.json');
  const spy = sinon.spy(soap.WSDL.prototype, 'findChildSchemaObject');

  soap.createClient(`${__dirname}/wsdl/perf/order.wsdl`, { strict: true }, (err, client) => {
    let i;
    let spyCall;

    assert.ifError(err);
    client.order(reqJson, err => {
      assert.ifError(err);
      assert.equal(client.lastMessage, expectedMsg);

      // since the reqJson does not use the element named "thing", then findChildSchemaObject should never get to the type named RabbitHole
      // see perf/ns1.xsd
      // this tests the fix for the performance problem where we too many calls to findChildSchemaObject
      // https://github.com/CumberlandGroup/node-ews/issues/58
      assert.ok(spy.callCount);
      for (i = 0; i < spy.callCount; i++) {
        spyCall = spy.getCall(i);
        if (spyCall.args[0]) {
          assert.notEqual(spyCall.args[0].$type, 'RabbitHole');
        }
      }

      spy.restore();
      done();
    });
  });
};

wsdlStrictTests['should get empty namespace prefix'] = done => {
  const expectedMsg = '<ns1:fooRq xmlns:ns1="http://example.com/bar/xsd"' +
    ' xmlns="http://example.com/bar/xsd"><bar1:paymentRq' +
    ' xmlns:bar1="http://example.com/bar1/xsd">' +
    '<bar1:bankSvcRq>' +
    '<requestUID>001</requestUID></bar1:bankSvcRq>' +
    '</bar1:paymentRq></ns1:fooRq>';
  // const expectedMsg = 'gg';

  soap.createClient(`${__dirname}/wsdl/elementref/foo.wsdl`, { strict: true }, (err, client) => {
    assert.ifError(err);
    client.fooOp({ paymentRq: { bankSvcRq: { ':requestUID': '001' } } }, err => {
      assert.ifError(err);
      assert.equal(client.lastMessage, expectedMsg);
      done();
    });
  });
};

wsdlNonStrictTests['should load same namespace from included xsd'] = done => {
  const expected = '{"DummyService":{"DummyPortType":{"Dummy":{"input":{"ID":"IdType|xs:string|pattern","Name":"NameType|xs:string|minLength,maxLength"},"output":{"Result":"dummy:DummyList"}}}}}';
  soap.createClient(`${__dirname}/wsdl/xsdinclude/xsd_include.wsdl`, (err, client) => {
    assert.ifError(err);
    assert.equal(JSON.stringify(client.describe()), expected);
    done();
  });
};

wsdlNonStrictTests['should all attributes to root elements'] = done => {
  const expectedMsg = '<ns1:fooRq xmlns:ns1="http://example.com/bar/xsd"' +
    ' xmlns="http://example.com/bar/xsd"><bar1:paymentRq bar1:test="attr"' +
    ' xmlns:bar1="http://example.com/bar1/xsd">' +
    '<bar1:bankSvcRq>' +
    '<requestUID>001</requestUID></bar1:bankSvcRq>' +
    '</bar1:paymentRq></ns1:fooRq>';
  // const expectedMsg = 'gg';

  soap.createClient(`${__dirname}/wsdl/elementref/foo.wsdl`, {}, (err, client) => {
    assert.ok(!err);
    client.fooOp({ paymentRq: { attributes: { 'bar1:test': 'attr' }, bankSvcRq: { ':requestUID': '001' } } }, err => {
      assert.ifError(err);
      assert.equal(client.lastMessage, expectedMsg);
      done();
    });
  });
};

module.exports = {
  'WSDL Parser (strict)': wsdlStrictTests,
  'WSDL Parser (non-strict)': wsdlNonStrictTests
};
