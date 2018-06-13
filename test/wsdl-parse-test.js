'use strict';

const path = require('path');
const { open_wsdl } = require('../lib/wsdl');
const assert = require('assert');

describe(__filename, () => {
  it('should parse recursive elements', done => {
    open_wsdl(path.resolve(__dirname, 'wsdl/recursive.wsdl'), (err, def) => {
      assert.equal(def.definitions.messages.operationRequest.parts['constraint[]'].expression,
        def.definitions.messages.operationRequest.parts['constraint[]'].expression.expression);
      assert.equal(def.definitions.messages.operationRequest.parts['constraint[]'].expression,
        def.definitions.messages.operationRequest.parts['constraint[]'].expression.expression['constraint[]'].expression);
      done();
    });
  });

  it('should parse recursive wsdls', done => {
    open_wsdl(path.resolve(__dirname, 'wsdl/recursive/file.wsdl'), (err, def) => {
      // If we get here then we succeeded
      done(err);
    });
  });

  it('should parse recursive wsdls keeping default options', done => {
    open_wsdl(path.resolve(__dirname, 'wsdl/recursive/file.wsdl'), (err, def) => {
      if (err) {
        return done(err);
      }

      def._includesWsdl.forEach(currentWsdl => {
        assert.deepEqual(def.options, currentWsdl.options);
      });

      done();
    });
  });

  it('should parse recursive wsdls keeping provided options', done => {
    open_wsdl(path.resolve(__dirname, 'wsdl/recursive/file.wsdl'), {
      ignoredNamespaces: {
        namespaces: ['targetNamespace', 'typedNamespace'],
        override: true
      }
    }, (err, def) => {
      if (err) {
        return done(err);
      }

      def._includesWsdl.forEach((currentWsdl, index) => {
        assert.deepEqual(def.options, currentWsdl.options);
      });

      done();
    });
  });
});
