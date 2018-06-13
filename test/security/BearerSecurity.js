'use strict';

describe('BearerSecurity', () => {
  const { BearerSecurity } = require('../../');
  const token = 'token';

  it('is a function', () => {
    BearerSecurity.should.be.type('function');
  });

  describe('defaultOption param', () => {
    it('is accepted as the second param', () => {
      new BearerSecurity(token, {});
    });

    it('is used in addOptions', () => {
      const options = {};
      const defaultOptions = { foo: 2 };
      const instance = new BearerSecurity(token, defaultOptions);
      instance.addOptions(options);
      options.should.have.property('foo', 2);
    });
  });
});
