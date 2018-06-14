'use strict';

const { merge } = require('lodash');

class BearerSecurity {
  constructor(token, defaults) {
    this._token = token;
    this.defaults = {};
    merge(this.defaults, defaults);
  }

  addHeaders(headers) {
    headers.Authorization = `Bearer ${this._token}`;
  }

  toXML() {
    return '';
  }

  addOptions(options) {
    merge(options, this.defaults);
  }
}

module.exports = BearerSecurity;
