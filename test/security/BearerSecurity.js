'use strict';

describe('BearerSecurity', function() {
  const BearerSecurity = require('../../').BearerSecurity;
  const token = "token";

  it('is a function', function() {
    BearerSecurity.should.be.type('function');
  });

  describe('defaultOption param', function() {
    it('is accepted as the second param', function() {
      new BearerSecurity(token, {});
    });

    it('is used in addOptions', function() {
      const options = {};
      const defaultOptions = { foo: 2 };
      const instance = new BearerSecurity(token, defaultOptions);
      instance.addOptions(options);
      options.should.have.property("foo", 2);
    });
  });
});
