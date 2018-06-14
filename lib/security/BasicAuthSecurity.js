'use strict';

const { merge } = require('lodash');

class BasicAuthSecurity {
  constructor(username, password, defaults) {
    this._username = username;
    this._password = password;
    this.defaults = {};
    merge(this.defaults, defaults);
  }

  addHeaders(headers) {
    // Buffer.from not available in v4.
    // eslint-disable-next-line
    headers.Authorization = `Basic ${new Buffer((`${this._username}:${this._password}`) || '').toString('base64')}`;
  }

  toXML() {
    return '';
  }

  addOptions(options) {
    merge(options, this.defaults);
  }
}

module.exports = BasicAuthSecurity;
