'use strict';

const _ = require('lodash');

class BasicAuthSecurity {
  constructor(username, password, defaults) {
    this._username = username;
    this._password = password;
    this.defaults = {};
    _.merge(this.defaults, defaults);
  }

  addHeaders(headers) {
    headers.Authorization = `Basic ${new Buffer((`${this._username}:${this._password}`) || '').toString('base64')}`;
  }

  toXML() {
    return '';
  }

  addOptions(options) {
    _.merge(options, this.defaults);
  }
}

module.exports = BasicAuthSecurity;
