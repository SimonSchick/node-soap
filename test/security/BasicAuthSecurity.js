'use strict';

describe('BasicAuthSecurity', () => {
  const { BasicAuthSecurity } = require('../../');
  const username = 'admin';
  const password = 'password1234';

  it('is a function', () => {
    BasicAuthSecurity.should.be.type('function');
  });

  describe('defaultOption param', () => {
    it('is accepted as the third param', () => {
      new BasicAuthSecurity(username, password, {});
    });

    it('is used in addOptions', () => {
      const options = {};
      const defaultOptions = { foo: 3 };
      const instance = new BasicAuthSecurity(username, password, defaultOptions);
      instance.addOptions(options);
      options.should.have.property('foo', 3);
    });
  });
});
