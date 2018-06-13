/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';


const HttpClient = require('./http');
const assert = require('assert');
const { EventEmitter } = require('events');
const debug = require('debug')('node-soap');
const { findPrefix } = require('./utils');
const _ = require('lodash');
const concatStream = require('concat-stream');
const BluebirdPromise = require('bluebird');
const uuid4 = require('uuid/v4');

const nonIdentifierChars = /[^a-z$_0-9]/i;

class Client extends EventEmitter {
  constructor(wsdl, endpoint, options) {
    super()
    options = options || {};
    this.wsdl = wsdl;
    this._initializeOptions(options);
    this._initializeServices(endpoint);
    this.httpClient = options.httpClient || new HttpClient(options);
    const promiseOptions = { multiArgs: true };
    if (options.overridePromiseSuffix) {
      promiseOptions.suffix = options.overridePromiseSuffix;
    }
    BluebirdPromise.promisifyAll(this, promiseOptions);
  }

  addSoapHeader(soapHeader, name, namespace, xmlns) {
    if (!this.soapHeaders) {
      this.soapHeaders = [];
    }
    if (typeof soapHeader === 'object') {
      soapHeader = this.wsdl.objectToXML(soapHeader, name, namespace, xmlns, true);
    }
    return this.soapHeaders.push(soapHeader) - 1;
  }

  changeSoapHeader(index, soapHeader, name, namespace, xmlns) {
    if (!this.soapHeaders) {
      this.soapHeaders = [];
    }
    if (typeof soapHeader === 'object') {
      soapHeader = this.wsdl.objectToXML(soapHeader, name, namespace, xmlns, true);
    }
    this.soapHeaders[index] = soapHeader;
  }

  getSoapHeaders() {
    return this.soapHeaders;
  }

  clearSoapHeaders() {
    this.soapHeaders = null;
  }

  addHttpHeader(name, value) {
    if (!this.httpHeaders) {
      this.httpHeaders = {};
    }
    this.httpHeaders[name] = value;
  }

  getHttpHeaders() {
    return this.httpHeaders;
  }

  clearHttpHeaders() {
    this.httpHeaders = {};
  }


  addBodyAttribute(bodyAttribute, name, namespace, xmlns) {
    if (!this.bodyAttributes) {
      this.bodyAttributes = [];
    }
    if (typeof bodyAttribute === 'object') {
      let composition = '';
      Object.getOwnPropertyNames(bodyAttribute).forEach((prop, idx, array) => {
        composition += ` ${prop}="${bodyAttribute[prop]}"`;
      });
      bodyAttribute = composition;
    }
    if (bodyAttribute.substr(0, 1) !== ' ') {bodyAttribute = ` ${bodyAttribute}`;}
    this.bodyAttributes.push(bodyAttribute);
  }

  getBodyAttributes() {
    return this.bodyAttributes;
  }

  clearBodyAttributes() {
    this.bodyAttributes = null;
  }

  setEndpoint(endpoint) {
    this.endpoint = endpoint;
    this._initializeServices(endpoint);
  }

  describe() {
    const { types } = this.wsdl.definitions;
    return this.wsdl.describeServices();
  }

  setSecurity(security) {
    this.security = security;
  }

  setSOAPAction(SOAPAction) {
    this.SOAPAction = SOAPAction;
  }

  _initializeServices(endpoint) {
    const { definitions } = this.wsdl;
    const { services } = definitions;
    for (const name in services) {
      this[name] = this._defineService(services[name], endpoint);
    }
  }

  _initializeOptions(options) {
    this.streamAllowed = options.stream;
    this.normalizeNames = options.normalizeNames;
    this.wsdl.options.attributesKey = options.attributesKey || 'attributes';
    this.wsdl.options.envelopeKey = options.envelopeKey || 'soap';
    this.wsdl.options.preserveWhitespace = !!options.preserveWhitespace;
    if(options.ignoredNamespaces !== undefined) {
      if(options.ignoredNamespaces.override !== undefined) {
        if(options.ignoredNamespaces.override === true) {
          if(options.ignoredNamespaces.namespaces !== undefined) {
            this.wsdl.options.ignoredNamespaces = options.ignoredNamespaces.namespaces;
          }
        }
      }
    }
    if(options.overrideRootElement !== undefined) {
      this.wsdl.options.overrideRootElement = options.overrideRootElement;
    }
    this.wsdl.options.forceSoap12Headers = !!options.forceSoap12Headers;
  }

  _defineService(service, endpoint) {
    const { ports } = service;
    const def = {};
    for (const name in ports) {
      def[name] = this._definePort(ports[name], endpoint ? endpoint : ports[name].location);
    }
    return def;
  }

  _definePort(port, endpoint) {
    const location = endpoint;
    const inding = port.binding;
    const { methods } = binding;
    const def = {};
    for (const name in methods) {
      def[name] = this._defineMethod(methods[name], location);
      const methodName = this.normalizeNames ? name.replace(nonIdentifierChars, '_') : name;
      this[methodName] = def[name];
    }
    return def;
  }

  _defineMethod(method, location) {
    const self = this;
    let temp;
    return function(args, callback, options, extraHeaders) {
      if (typeof args === 'function') {
        callback = args;
        args = {};
      } else if (typeof options === 'function') {
        temp = callback;
        callback = options;
        options = temp;
      } else if (typeof extraHeaders === 'function') {
        temp = callback;
        callback = extraHeaders;
        extraHeaders = options;
        options = temp;
      }
      self._invoke(method, args, location, (error, result, rawResponse, soapHeader, rawRequest) => {
        callback(error, result, rawResponse, soapHeader, rawRequest);
      }, options, extraHeaders);
    };
  }

  _invoke(method, args, location, callback, options, extraHeaders) {
    const self = this;
    const name = method.$name;
    const { input, output, style } = method;
    const defs = this.wsdl.definitions;
    const { envelopeKey } = this.wsdl.options;
    const ns = defs.$targetNamespace;
    let encoding = '';
    let message = '';
    let xml = null;
    let req = null;
    let soapAction;
    const alias = findPrefix(defs.xmlns, ns);
    const headers = {
      'Content-Type': 'text/xml; charset=utf-8'
    };
    let xmlnsSoap = `xmlns:${envelopeKey}="http://schemas.xmlsoap.org/soap/envelope/"`;

    if (this.wsdl.options.forceSoap12Headers) {
      headers['Content-Type'] = 'application/soap+xml; charset=utf-8';
      xmlnsSoap = `xmlns:${envelopeKey}="http://www.w3.org/2003/05/soap-envelope"`;
    }

    if (this.SOAPAction) {
      soapAction = this.SOAPAction;
    } else if (method.soapAction !== undefined && method.soapAction !== null) {
      ({ soapAction } = method);
    } else {
      soapAction = ((ns.lastIndexOf('/') !== ns.length - 1) ? `${ns}/` : ns) + name;
    }

    if (!this.wsdl.options.forceSoap12Headers) {
      headers.SOAPAction = `"${soapAction}"`;
    }

    options = options || {};

    // Add extra headers
    for (const header in this.httpHeaders) { headers[header] = this.httpHeaders[header];  }
    for (const attr in extraHeaders) { headers[attr] = extraHeaders[attr]; }

    // Allow the security object to add headers
    if (self.security && self.security.addHeaders)
    {self.security.addHeaders(headers);}
    if (self.security && self.security.addOptions)
    {self.security.addOptions(options);}

    if ((style === 'rpc') && ((input.parts || input.name === 'element') || args === null)) {
      assert.ok(!style || style === 'rpc', 'invalid message definition for document style binding');
      message = self.wsdl.objectToRpcXML(name, args, alias, ns, (input.name !== 'element'));
      (method.inputSoap === 'encoded') && (encoding = 'soap:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" ');
    } else {
      assert.ok(!style || style === 'document', 'invalid message definition for rpc style binding');
      // pass `input.$lookupType` if `input.$type` could not be found
      message = self.wsdl.objectToDocumentXML(input.$name, args, input.targetNSAlias, input.targetNamespace, (input.$type || input.$lookupType));
    }
    xml = `${'<?xml version="1.0" encoding="utf-8"?>' +
      '<'}${envelopeKey}:Envelope ${
      xmlnsSoap} ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${
        encoding
      }${this.wsdl.xmlnsInEnvelope}>${
        (self.soapHeaders || self.security) ?
          (
            `<${envelopeKey}:Header>${
              self.soapHeaders ? self.soapHeaders.join('\n') : ''
            }${self.security && !self.security.postProcess ? self.security.toXML() : ''
            }</${envelopeKey}:Header>`
          )
          :
          ''
      }<${envelopeKey}:Body${
        self.bodyAttributes ? self.bodyAttributes.join(' ') : ''
      }${self.security && self.security.postProcess ? ' Id="_0"' : ''
      }>${
        message
      }</${envelopeKey}:Body>` +
      `</${envelopeKey}:Envelope>`;

    if(self.security && self.security.postProcess){
      xml = self.security.postProcess(xml, envelopeKey);
    }

    if(options && options.postProcess){
      xml = options.postProcess(xml);
    }

    self.lastMessage = message;
    self.lastRequest = xml;
    self.lastEndpoint = location;

    const eid = options.exchangeId || uuid4();

    self.emit('message', message, eid);
    self.emit('request', xml, eid);

    const tryJSONparse = function(body) {
      try {
        return JSON.parse(body);
      }
      catch(err) {
        return undefined;
      }
    };

    if (this.streamAllowed && typeof self.httpClient.requestStream === 'function') {
      callback = _.once(callback);
      const startTime = Date.now();
      req = self.httpClient.requestStream(location, xml, headers, options, self);
      self.lastRequestHeaders = req.headers;
      const onError = function onError(err) {
        self.lastResponse = null;
        self.lastResponseHeaders = null;
        self.lastElapsedTime = null;
        self.emit('response', null, null, eid);

        callback(err, undefined, undefined, undefined, xml);
      };
      req.on('error', onError);
      req.on('response', response => {
        response.on('error', onError);

        // When the output element cannot be looked up in the wsdl, play it safe and
        // don't stream
        if(response.statusCode !== 200 || !output || !output.$lookupTypes) {
          response.pipe(concatStream({ encoding: 'string' }, body => {
            self.lastResponse = body;
            self.lastResponseHeaders = response && response.headers;
            self.lastElapsedTime = Date.now() - startTime;
            self.emit('response', body, response, eid);

            return parseSync(body, response);

          }));
          return;
        }

        self.wsdl.xmlToObject(response, (error, obj) => {
          self.lastResponse = response;
          self.lastResponseHeaders = response && response.headers;
          self.lastElapsedTime = Date.now() - startTime;
          self.emit('response', '<stream>', response, eid);

          if (error) {
            error.response = response;
            error.body = '<stream>';
            self.emit('soapError', error, eid);
            return callback(error, response, undefined, undefined, xml);
          }

          return finish(obj, '<stream>', response);
        });
      });
      return;
    }

    req = self.httpClient.request(location, xml, (err, response, body) => {
      self.lastResponse = body;
      self.lastResponseHeaders = response && response.headers;
      self.lastElapsedTime = response && response.elapsedTime;
      self.emit('response', body, response, eid);

      if (err) {
        callback(err, undefined, undefined, undefined, xml);
      } else {
        return parseSync(body, response);
      }
    }, headers, options, self);

    function parseSync(body, response) {
      let obj;
      try {
        obj = self.wsdl.xmlToObject(body);
      } catch (error) {
        //  When the output element cannot be looked up in the wsdl and the body is JSON
        //  instead of sending the error, we pass the body in the response.
        if(!output || !output.$lookupTypes) {
          debug('Response element is not present. Unable to convert response xml to json.');
          //  If the response is JSON then return it as-is.
          const json = _.isObject(body) ? body : tryJSONparse(body);
          if (json) {
            return callback(null, response, json, undefined, xml);
          }
        }
        error.response = response;
        error.body = body;
        self.emit('soapError', error, eid);
        return callback(error, response, body, undefined, xml);
      }
      return finish(obj, body, response);
    }

    function finish(obj, body, response) {
      let result;

      if (!output){
        // one-way, no output expected
        return callback(null, null, body, obj.Header, xml);
      }

      // If it's not HTML and Soap Body is empty
      if (!obj.html && !obj.Body) {
        return callback(null, obj, body, obj.Header);
      }

      if(typeof obj.Body !== 'object') {
        const error = new Error('Cannot parse response');
        error.response = response;
        error.body = body;
        return callback(error, obj, body, undefined, xml);
      }

      result = obj.Body[output.$name];
      // RPC/literal response body may contain elements with added suffixes I.E.
      // 'Response', or 'Output', or 'Out'
      // This doesn't necessarily equal the ouput message name. See WSDL 1.1 Section 2.4.5
      if(!result){
        result = obj.Body[output.$name.replace(/(?:Out(?:put)?|Response)$/, '')];
      }
      if (!result) {
        ['Response', 'Out', 'Output'].forEach(term => {
          if (obj.Body.hasOwnProperty(name + term)) {
            return result = obj.Body[name + term];
          }
        });
      }

      callback(null, result, body, obj.Header, xml);
    }

    // Added mostly for testability, but possibly useful for debugging
    if(req && req.headers && !options.ntlm) // fixes an issue when req or req.headers is undefined, doesn't apply to ntlm requests
    {self.lastRequestHeaders = req.headers;}
  }
}

exports.Client = Client;
