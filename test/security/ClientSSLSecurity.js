'use strict';

const fs = require('fs');
const { join } = require('path');

describe('ClientSSLSecurity', () => {
  const { ClientSSLSecurity } = require('../../');
  const cert = __filename;
  const key = __filename;

  it('is a function', () => {
    ClientSSLSecurity.should.be.type('function');
  });

  describe('defaultOption param', () => {
    it('is accepted as the third param', () => {
      new ClientSSLSecurity(null, null, {});
    });

    it('is used in addOptions', () => {
      const options = {};
      const defaultOptions = { foo: 5 };
      const instance = new ClientSSLSecurity(null, null, defaultOptions);
      instance.addOptions(options);
      options.should.have.property('foo', 5);
    });
  });


  it('should accept extraneous data before cert encapsulation boundaries per rfc 7468', () => {
    const certBuffer = fs.readFileSync(join(__dirname, '..', 'certs', 'agent2-cert-with-extra-data.pem'));

    const instanceCert = new ClientSSLSecurity(null, certBuffer);
  });

  it('should accept a Buffer as argument for the key or cert', () => {
    const certBuffer = fs.readFileSync(join(__dirname, '..', 'certs', 'agent2-cert.pem'));
    const keyBuffer = fs.readFileSync(join(__dirname, '..', 'certs', 'agent2-key.pem'));

    const instance = new ClientSSLSecurity(keyBuffer, certBuffer, certBuffer);
    instance.should.have.property('ca', certBuffer);
    instance.should.have.property('cert', certBuffer);
    instance.should.have.property('key', keyBuffer);
  });

  it('should accept a Array as argument for the ca', () => {
    const caList = [];
    const instance = new ClientSSLSecurity(null, null, caList);
    instance.should.have.property('ca', caList);
  });

  describe('forever parameter', () => {
    it('should return different agents if parameter is not present', () => {
      const instance = new ClientSSLSecurity();
      const firstOptions = {};
      const secondOptions = {};

      instance.addOptions(firstOptions);
      instance.addOptions(secondOptions);

      firstOptions.agent.should.not.equal(secondOptions.agent);
    });

    it('should return the same agent if parameter is present', () => {
      const instance = new ClientSSLSecurity();
      const firstOptions = { forever: true };
      const secondOptions = { forever: true };

      instance.addOptions(firstOptions);
      instance.addOptions(secondOptions);

      firstOptions.agent.should.equal(secondOptions.agent);
    });

    it('should return the same agent if set in defaults', () => {
      const instance = new ClientSSLSecurity(null, null, null, { forever: true });
      const firstOptions = {};
      const secondOptions = {};

      instance.addOptions(firstOptions);
      instance.addOptions(secondOptions);

      firstOptions.agent.should.equal(secondOptions.agent);
    });
  });
});
