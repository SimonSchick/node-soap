/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

const url = require('url');
const request = require('request');
const debug = require('debug')('node-soap');
const httpNtlm = require('httpntlm');

const VERSION = require('../package.json').version;

/**
 * A class representing the http client
 */
class HttpClient {

  /**
   * @param {Object} [options] Options object. It allows the customization of
   * `request` module
   */
  constructor(options) {
    options = options || {};
    this._request = options.request || request;
  }

  /**
   * Build the HTTP request (method, uri, headers, ...)
   * @param {String} rurl The resource url
   * @param {Object|String} data The payload
   * @param {Object} exheaders Extra http headers
   * @param {Object} exoptions Extra options
   * @returns {Object} The http request object for the `request` module
   */
  buildRequest(rurl, data, exheaders, exoptions) {
    const curl = url.parse(rurl);
    const host = curl.hostname;
    const port = parseInt(curl.port, 10);
    const method = data ? 'POST' : 'GET';
    const headers = {
      'User-Agent': `node-soap/${VERSION}`,
      Accept: 'text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      'Accept-Encoding': 'none',
      'Accept-Charset': 'utf-8',
      Connection: exoptions && exoptions.forever ? 'keep-alive' : 'close',
      Host: host + (isNaN(port) ? '' : `:${port}`)
    };
    let attr;
    let header;
    const mergeOptions = ['headers'];

    if (typeof data === 'string') {
      headers['Content-Length'] = Buffer.byteLength(data, 'utf8');
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    exheaders = exheaders || {};
    for (attr in exheaders) {
      if (!exheaders.hasOwnProperty(attr)) {
        continue;
      }
      headers[attr] = exheaders[attr];
    }

    const options = {
      uri: curl,
      method,
      headers,
      followAllRedirects: true
    };


    options.body = data;


    exoptions = exoptions || {};
    for (attr in exoptions) {
      if (mergeOptions.includes(attr)) {
        const opt = exoptions[attr];
        for (header in opt) {
          if (!opt.hasOwnProperty(header)) {
            continue;
          }
          options[attr][header] = exoptions[attr][header];
        }
      } else {
        options[attr] = exoptions[attr];
      }
    }
    debug('Http request: %j', options);
    return options;
  }

  /**
   * Handle the http response
   * @param {Object} The req object
   * @param {Object} res The res object
   * @param {Object} body The http body
   * @param {Object} The parsed body
   */
  handleResponse(req, res, body) {
    debug('Http response body: %j', body);
    if (typeof body === 'string') {
      // Remove any extra characters that appear before or after the SOAP envelope.
      const match =
        body.replace(/<!--[\s\S]*?-->/, '').match(/(?:<\?[^?]*\?>[\s]*)?<([^:]*):Envelope([\S\s]*)<\/\1:Envelope>/i);
      if (match) {
        [body] = match;
      }
    }
    return body;
  }

  request(rurl, data, callback, exheaders, exoptions) {
    const options = this.buildRequest(rurl, data, exheaders, exoptions);
    let req;

    if (exoptions !== undefined && exoptions.hasOwnProperty('ntlm')) {
      // Sadly when using ntlm nothing to return
      // Not sure if this can be handled in a cleaner way rather than an if/else,
      // Will to tidy up if I get chance later, patches welcome - insanityinside
      options.url = rurl;
      httpNtlm[options.method.toLowerCase()](options, (err, res) => {
        if (err) {
          callback(err);
          return;
        }
        // If result is stream
        if (typeof res.body !== 'string') {
          res.body = res.body.toString();
        }
        res.body = this.handleResponse(req, res, res.body);
        callback(null, res, res.body);
      });
    } else {
      req = this._request(options, (err, res, body) => {
        if (err) {
          callback(err);
          return;
        }
        body = this.handleResponse(req, res, body);
        callback(null, res, body);
      });
    }

    return req;
  }

  requestStream(rurl, data, exheaders, exoptions) {
    const options = this.buildRequest(rurl, data, exheaders, exoptions);
    return this._request(options);
  }
}
module.exports = HttpClient;
