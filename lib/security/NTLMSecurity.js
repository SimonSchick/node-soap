"use strict";

var _ = require('lodash');

class NTLMSecurity {
  constructor(username, password, domain, workstation) {
    if (typeof username === "object") {
      this.defaults = username;
      this.defaults.ntlm = true;
    } else {
      this.defaults = {
        ntlm: true,
        username: username,
        password: password,
        domain: domain,
        workstation: workstation
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
