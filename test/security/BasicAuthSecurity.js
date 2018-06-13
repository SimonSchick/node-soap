'use strict';

describe('BasicAuthSecurity', function() {
  const BasicAuthSecurity = require('../../').BasicAuthSecurity;
  const username = "admin";
  const password = "password1234";

  it('is a function', function() {
    BasicAuthSecurity.should.be.type('function');
  });

  describe('defaultOption param', function() {
    it('is accepted as the third param', function() {
      new BasicAuthSecurity(username, password, {});
    });

    it('is used in addOptions', function() {
      const options = {};
      const defaultOptions = { foo: 3 };
      const instance = new BasicAuthSecurity(username, password, defaultOptions);
      instance.addOptions(options);
      options.should.have.property("foo", 3);
    });
  });
});
