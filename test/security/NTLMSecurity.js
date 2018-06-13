'use strict';

describe('NTLMSecurity', () => {
  const { NTLMSecurity } = require('../../');
  const username = 'admin';
  const password = 'password1234';
  const domain = 'LOCAL';
  const workstation = 'MACHINE';

  it('is a function', () => {
    NTLMSecurity.should.be.type('function');
  });

  describe('constructor', () => {
    it('should optionally accept an options object as the first parameter', () => {
      const options = {
        username,
        password,
        domain,
        workstation
      };
      const instance = new NTLMSecurity(options);
      instance.defaults.should.have.property('username', options.username);
      instance.defaults.should.have.property('password', options.password);
      instance.defaults.should.have.property('domain', options.domain);
      instance.defaults.should.have.property('workstation', options.workstation);
      instance.defaults.should.have.property('ntlm', true);
    });

    it('should accept valid variables', () => {
      const instance = new NTLMSecurity(username, password, domain, workstation);
      instance.defaults.should.have.property('username', username);
      instance.defaults.should.have.property('password', password);
      instance.defaults.should.have.property('domain', domain);
      instance.defaults.should.have.property('workstation', workstation);
      instance.defaults.should.have.property('ntlm', true);
    });
  });

  describe('addHeaders', () => {
    it('should set connection as \'keep-alive\'', () => {
      const headers = {};
      const instance = new NTLMSecurity(username, password);
      instance.addHeaders(headers);
      headers.should.have.property('Connection', 'keep-alive');
    });
  });

  describe('defaultOption param', () => {
    it('is used in addOptions', () => {
      const options = {};
      const instance = new NTLMSecurity(username, password);
      instance.addOptions(options);
      options.should.have.property('username', username);
      options.should.have.property('password', password);
    });
  });
});
