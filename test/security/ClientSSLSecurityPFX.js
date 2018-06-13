'use strict';

const fs = require('fs');
const { join } = require('path');

describe('ClientSSLSecurityPFX', () => {
  const { ClientSSLSecurityPFX } = require('../../');
  const pfx = __filename;

  it('should be function', () => {
    ClientSSLSecurityPFX.should.be.type('function');
  });

  describe('defaultOption param', () => {
    it('should be accepted as the second param', () => {
      new ClientSSLSecurityPFX(null, {});
    });

    it('should be used in addOptions', () => {
      const options = {};
      const defaultOptions = { foo: 5 };
      const instance = new ClientSSLSecurityPFX(null, defaultOptions);
      instance.addOptions(options);
      options.should.have.property('foo', 5);
    });
  });

  it('should throw if invalid pfk file is given', () => {
    let instanceCert = null;

    try {
      instanceCert = new ClientSSLSecurityPFX({});
    } catch (e) {
      // should happen!
      instanceCert = false;
    }

    if (instanceCert !== false) {
      throw new Error('accepted wrong pfk');
    }
  });

  xit('should be usable in a request', done => {
    const https = require('https');
    const pfkBuffer = fs.readFileSync(join(__dirname, '..', 'certs', 'client-password.pfx'));

    const instance = new ClientSSLSecurityPFX(pfkBuffer, 'test2test');
    const soptions = {
      host: 'localhost',
      port: 1338,
      requestCert: true,
      rejectUnauthorized: false,
      pfx: fs.readFileSync(join(__dirname, '..', 'certs', 'server-password.pfx')),
      passphrase: 'test2test',
    };
    const options = {
      port: 1338
    };
    instance.addOptions(options);

    const server = https.createServer(soptions, (req, res) => {
      req.socket.should.have.property('authorized', true);
      // Doesn't work in older versions of nodejs
      // req.socket.should.have.property('authorizationError', null);
      res.writeHead(200);
      res.end('OK');
    });

    server.listen(soptions.port, soptions.host, () => {
      let data = '';

      https.get(options, res => {
        res.on('data', data_ => { data += data_; });
        res.on('end', () => {
          server.close();
          data.should.equal('OK');
          done();
        });
      });
    });
  });

  it('should accept a passphrase as argument for the pfx cert', () => {
    const pfkBuffer = fs.readFileSync(join(__dirname, '..', 'certs', 'client-password.pfx'));

    const instance = new ClientSSLSecurityPFX(pfkBuffer, 'test2est');
    instance.should.have.property('pfx', pfkBuffer);
    instance.should.have.property('passphrase', 'test2est');
  });

  it('should accept a Buffer as argument for the pfx cert', () => {
    const pfkBuffer = fs.readFileSync(join(__dirname, '..', 'certs', 'pfk-buffer.pfx'));

    const instance = new ClientSSLSecurityPFX(pfkBuffer);
    instance.should.have.property('pfx', pfkBuffer);
  });
});
