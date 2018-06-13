'use strict';

const fs = require('fs');
const { join } = require('path');

describe('WSSecurityCert', () => {
  const { WSSecurityCert } = require('../../');
  const cert = fs.readFileSync(join(__dirname, '..', 'certs', 'agent2-cert.pem'));
  const key = fs.readFileSync(join(__dirname, '..', 'certs', 'agent2-key.pem'));
  const keyWithPassword = fs.readFileSync(join(__dirname, '..', 'certs', 'agent2-key-with-password.pem')); // The passphrase protecting the private key is "soap"

  it('is a function', () => {
    WSSecurityCert.should.be.type('function');
  });

  it('should accept valid constructor variables', () => {
    const instance = new WSSecurityCert(key, cert, '');
    instance.should.have.property('publicP12PEM');
    instance.should.have.property('signer');
    instance.should.have.property('x509Id');
  });

  it('should fail at computing signature when the private key is invalid', () => {
    let passed = true;

    try {
      const instance = new WSSecurityCert('*****', cert, '');
      instance.postProcess('<soap:Header></soap:Header><soap:Body></soap:Body>', 'soap');
    } catch(e) {
      passed = false;
    }

    if (passed) {
      throw new Error('bad private key');
    }
  });

  it('should insert a WSSecurity signing block when postProcess is called (private key is raw)', () => {
    const instance = new WSSecurityCert(key, cert, '');
    const xml = instance.postProcess('<soap:Header></soap:Header><soap:Body></soap:Body>', 'soap');

    xml.should.containEql('<wsse:Security');
    xml.should.containEql('http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd');
    xml.should.containEql('http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd');
    xml.should.containEql('soap:mustUnderstand="1"');
    xml.should.containEql('<wsse:BinarySecurityToken');
    xml.should.containEql('EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary');
    xml.should.containEql('ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"');
    xml.should.containEql(`wsu:Id="${instance.x509Id}`);
    xml.should.containEql('</wsse:BinarySecurityToken>');
    xml.should.containEql('<Timestamp xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" Id="_1">');
    xml.should.containEql(`<Created>${instance.created}`);
    xml.should.containEql(`<Expires>${instance.expires}`);
    xml.should.containEql('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    xml.should.containEql('<wsse:SecurityTokenReference>');
    xml.should.containEql(`<wsse:Reference URI="#${instance.x509Id}`);
    xml.should.containEql('ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>');
    xml.should.containEql(instance.publicP12PEM);
    xml.should.containEql(instance.signer.getSignatureXml());
  });

  it('should insert a WSSecurity signing block when postProcess is called (private key is protected by a passphrase)', () => {
    const instance = new WSSecurityCert(keyWithPassword, cert, 'soap');
    const xml = instance.postProcess('<soap:Header></soap:Header><soap:Body></soap:Body>', 'soap');

    xml.should.containEql('<wsse:Security');
    xml.should.containEql('http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd');
    xml.should.containEql('http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd');
    xml.should.containEql('soap:mustUnderstand="1"');
    xml.should.containEql('<wsse:BinarySecurityToken');
    xml.should.containEql('EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary');
    xml.should.containEql('ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"');
    xml.should.containEql(`wsu:Id="${instance.x509Id}`);
    xml.should.containEql('</wsse:BinarySecurityToken>');
    xml.should.containEql('<Timestamp xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" Id="_1">');
    xml.should.containEql(`<Created>${instance.created}`);
    xml.should.containEql(`<Expires>${instance.expires}`);
    xml.should.containEql('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    xml.should.containEql('<wsse:SecurityTokenReference>');
    xml.should.containEql(`<wsse:Reference URI="#${instance.x509Id}`);
    xml.should.containEql('ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"/>');
    xml.should.containEql(instance.publicP12PEM);
    xml.should.containEql(instance.signer.getSignatureXml());
  });

  it('should only add two Reference elements, for Soap Body and Timestamp inside wsse:Security element', () => {
    const instance = new WSSecurityCert(key, cert, '');
    const xml = instance.postProcess('<soap:Header></soap:Header><soap:Body><Body></Body><Timestamp></Timestamp></soap:Body>', 'soap');

    xml.match(/<Reference URI="#/g).should.have.length(2);
  });
});
