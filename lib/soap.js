/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

const { Client } = require('./client');
const { Server } = require('./server');
const HttpClient = require('./http');
const security = require('./security');
const { passwordDigest } = require('./utils');
const BluebirdPromise = require('bluebird');
const wsdl = require('./wsdl');
const { WSDL } = require('./wsdl');

function createCache() {
  const cache = {};
  return function(key, load, callback) {
    if (cache[key]) {
      process.nextTick(() => {
        callback(null, cache[key]);
      });
      return;
    }
    load((err, result) => {
      if (err) {
        callback(err);
        return;
      }
      cache[key] = result;
      callback(null, result);
    });
  };
}
const getFromCache = createCache();

function _requestWSDL(url, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const openWsdl = wsdl.openWsdl.bind(null, url, options);

  if (options.disableCache === true) {
    openWsdl(callback);
  } else {
    getFromCache(url, openWsdl, callback);
  }
}

function createClient(url, options, callback, endpoint) {
  if (typeof options === 'function') {
    endpoint = callback;
    callback = options;
    options = {};
  }
  endpoint = options.endpoint || endpoint;
  _requestWSDL(url, options, (err, innerWSDL) => {
    callback(err, innerWSDL && new Client(innerWSDL, endpoint, options));
  });
}

function createClientAsync(url, options, endpoint) {
  if (typeof options === 'undefined') {
    options = {};
  }
  return new BluebirdPromise((resolve, reject) => {
    createClient(url, options, (err, client) => {
      if (err) {
        reject(err);
      }
      resolve(client);
    }, endpoint);
  });
}

function listen(server, pathOrOptions, services, xml) {
  let options = {};
  let path = pathOrOptions;
  let uri = '';

  if (typeof pathOrOptions === 'object') {
    options = pathOrOptions;
    ({ path, services, xml, uri } = options);
  }

  const wsdlInstance = new WSDL(xml || services, uri, options);
  return new Server(server, path, services, wsdlInstance, options);
}

exports.security = security;
exports.BasicAuthSecurity = security.BasicAuthSecurity;
exports.NTLMSecurity = security.NTLMSecurity;
exports.WSSecurity = security.WSSecurity;
exports.WSSecurityCert = security.WSSecurityCert;
exports.ClientSSLSecurity = security.ClientSSLSecurity;
exports.ClientSSLSecurityPFX = security.ClientSSLSecurityPFX;
exports.BearerSecurity = security.BearerSecurity;
exports.createClient = createClient;
exports.createClientAsync = createClientAsync;
exports.passwordDigest = passwordDigest;
exports.listen = listen;
exports.WSDL = WSDL;

// Export Client and Server to allow customization
exports.Server = Server;
exports.Client = Client;
exports.HttpClient = HttpClient;
