'use strict';

const _ = require('lodash');

class NTLMSecurity {
  constructor(username, password, domain, workstation) {
    if (typeof username === 'object') {
      this.defaults = username;
      this.defaults.ntlm = true;
    } else {
      this.defaults = {
        ntlm: true,
        username,
        password,
        domain,
        workstation
      };
    }
  }

  addHeaders(headers) {
    headers.Connection = 'keep-alive';
  }

  toXML() {
    return '';
  }

  addOptions(options) {
    _.merge(options, this.defaults);
  }
}

module.exports = NTLMSecurity;
