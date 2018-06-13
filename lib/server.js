/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 */

'use strict';

const url = require('url');
const zlib = (() => { try { return require('zlib') } catch(e) { return null } })();
const { EventEmitter } = require('events');
const { findPrefix, getDate } = require('./utils');

class Server extends EventEmitter {
  constructor(server, path, services, wsdl, options) {
    super();
    const self = this;

    options = options || {};
    this.path = path;
    this.services = services;
    this.wsdl = wsdl;
    this.suppressStack = options && options.suppressStack;
    this.returnFault = options && options.returnFault;
    this.onewayOptions = options && options.oneWay || {};

    if (path[path.length - 1] !== '/')
    {path += '/';}
    wsdl.onReady(err => {
      if (typeof server.route === 'function' && typeof server.use === 'function') {
        // handle only the required URL path for express server
        server.route(path).all((req, res, next) => {
          if (typeof self.authorizeConnection === 'function') {
            if (!self.authorizeConnection(req, res)) {
              res.end();
              return;
            }
          }
          self._requestListener(req, res);
        });
      } else {
        const listeners = server.listeners('request').slice();
        server.removeAllListeners('request');
        server.addListener('request', function(req, res) {
          if (typeof self.authorizeConnection === 'function') {
            if (!self.authorizeConnection(req, res)) {
              res.end();
              return;
            }
          }
          let reqPath = url.parse(req.url).pathname;
          if (reqPath[reqPath.length - 1] !== '/') {
            reqPath += '/';
          }
          if (path === reqPath) {
            self._requestListener(req, res);
          } else {
            for (let i = 0, len = listeners.length; i < len; i++) {
              listeners[i].call(this, req, res);
            }
          }
        });
      }
    });

    this._initializeOptions(options);
  }

  _processSoapHeader(soapHeader, name, namespace, xmlns) {
    const self = this;

    switch (typeof soapHeader) {
    case 'object':
      return this.wsdl.objectToXML(soapHeader, name, namespace, xmlns, true);
    case 'function':
      return function() {
        const result = soapHeader.apply(null, arguments);

        if (typeof result === 'object') {
          return self.wsdl.objectToXML(result, name, namespace, xmlns, true);
        } else {
          return result;
        }
      };
    default:
      return soapHeader;
    }
  };

  addSoapHeader(soapHeader, name, namespace, xmlns) {
    if (!this.soapHeaders) {
      this.soapHeaders = [];
    }
    soapHeader = this._processSoapHeader(soapHeader, name, namespace, xmlns);
    return this.soapHeaders.push(soapHeader) - 1;
  };

  changeSoapHeader(index, soapHeader, name, namespace, xmlns) {
    if (!this.soapHeaders) {
      this.soapHeaders = [];
    }
    soapHeader = this._processSoapHeader(soapHeader, name, namespace, xmlns);
    this.soapHeaders[index] = soapHeader;
  };

  getSoapHeaders() {
    return this.soapHeaders;
  };

  clearSoapHeaders() {
    this.soapHeaders = null;
  };

  _initializeOptions(options) {
    this.wsdl.options.attributesKey = options.attributesKey || 'attributes';
    this.onewayOptions.statusCode = this.onewayOptions.responseCode || 200;
    this.onewayOptions.emptyBody = !!this.onewayOptions.emptyBody;
  };

  _processRequestXml(req, res, xml) {
    const self = this;
    let result;
    let error;
    try {
      if (typeof self.log === 'function') {
        self.log('received', xml);
      }
      self._process(xml, req, (result, statusCode) => {
        if (statusCode) {
          res.statusCode = statusCode;
        }
        res.write(result);
        res.end();
        if (typeof self.log === 'function') {
          self.log('replied', result);
        }
      });
    } catch (err) {
      if (err.Fault !== undefined) {
        return self._sendError(err.Fault, (result, statusCode) => {
          res.statusCode = statusCode || 500;
          res.write(result);
          res.end();
          if (typeof self.log === 'function') {
            self.log('error', err);
          }
        }, new Date().toISOString());
      } else {
        error = err.stack ? (self.suppressStack === true ? err.message : err.stack) : err;
        res.statusCode = 500;
        res.write(error);
        res.end();
        if (typeof self.log === 'function') {
          self.log('error', error);
        }
      }
    }
  };

  _requestListener(req, res) {
    const self = this;
    const reqParse = url.parse(req.url);
    const reqPath = reqParse.pathname;
    const reqQuery = reqParse.search;

    if (typeof self.log === 'function') {
      self.log('info', `Handling ${req.method} on ${req.url}`);
    }

    if (req.method === 'GET') {
      if (reqQuery && reqQuery.toLowerCase() === '?wsdl') {
        if (typeof self.log === 'function') {
          self.log('info', 'Wants the WSDL');
        }
        res.setHeader('Content-Type', 'application/xml');
        res.write(self.wsdl.toXML());
      }
      res.end();
    } else if (req.method === 'POST') {
      if (typeof req.headers['content-type'] !== 'undefined') {
        res.setHeader('Content-Type', req.headers['content-type']);
      } else {
        res.setHeader('Content-Type', 'application/xml');
      }

      // request body is already provided by an express middleware
      // in this case unzipping should also be done by the express middleware itself
      if (req.body) {
        return self._processRequestXml(req, res, req.body.toString());
      }

      const chunks = []
      let gunzip;
      let source = req;
      if (req.headers['content-encoding'] === 'gzip') {
        gunzip = zlib.createGunzip();
        req.pipe(gunzip);
        source = gunzip;
      }
      source.on('data', chunk => {
        chunks.push(chunk);
      });
      source.on('end', () => {
        const xml = chunks.join('');
        let result;
        let error;
        self._processRequestXml(req, res, xml);
      });
    }
    else {
      res.end();
    }
  };

  _process(input, req, callback) {
    const self = this;
    const pathname = url.parse(req.url).pathname.replace(/\/$/, '');
    const obj = this.wsdl.xmlToObject(input);
    const body = obj.Body;
    const headers = obj.Header;
    const { bindings } = this.wsdl.definitions;
    let binding;
    let method;
    let methodName;
    let serviceName;
    let portName;
    const includeTimestamp = obj.Header && obj.Header.Security && obj.Header.Security.Timestamp;
    const authenticate = self.authenticate || function defaultAuthenticate() { return true; };

    function process() {

      if (typeof self.log === 'function') {
        self.log('info', `Attempting to bind to ${pathname}`);
      }

      // Avoid Cannot convert undefined or null to object due to Object.keys(body)
      // and throw more meaningful error
      if (!body) {
        throw new Error('Failed to parse the SOAP Message body');
      }

      // use port.location and current url to find the right binding
      binding = (function() {
        const { services } = self.wsdl.definitions;
        let firstPort;
        let name;
        for (name in services) {
          serviceName = name;
          const service = services[serviceName];
          const { ports } = service;
          for (name in ports) {
            portName = name;
            const port = ports[portName];
            const portPathname = url.parse(port.location).pathname.replace(/\/$/, '');

            if (typeof self.log === 'function') {
              self.log('info', `Trying ${portName} from path ${portPathname}`);
            }

            if (portPathname === pathname)
            {return port.binding;}

            // The port path is almost always wrong for generated WSDLs
            if (!firstPort) {
              firstPort = port;
            }
          }
        }
        return !firstPort ? void 0 : firstPort.binding;
      })();

      if (!binding) {
        throw new Error('Failed to bind to WSDL');
      }

      try {
        if (binding.style === 'rpc') {
          [methodName] = Object.keys(body);

          self.emit('request', obj, methodName);
          if (headers)
          {self.emit('headers', headers, methodName);}

          self._executeMethod({
            serviceName,
            portName,
            methodName,
            outputName: `${methodName}Response`,
            args: body[methodName],
            headers,
            style: 'rpc'
          }, req, callback);
        } else {
          const messageElemName = (Object.keys(body)[0] === 'attributes' ? Object.keys(body)[1] : Object.keys(body)[0]);
          const pair = binding.topElements[messageElemName];

          self.emit('request', obj, pair.methodName);
          if (headers)
          {self.emit('headers', headers, pair.methodName);}

          self._executeMethod({
            serviceName,
            portName,
            methodName: pair.methodName,
            outputName: pair.outputName,
            args: body[messageElemName],
            headers,
            style: 'document'
          }, req, callback, includeTimestamp);
        }
      }
      catch (error) {
        if (error.Fault !== undefined) {
          return self._sendError(error.Fault, callback, includeTimestamp);
        }

        throw error;
      }
    }

    // Authentication

    if (typeof authenticate === 'function') {

      let authResultProcessed = false;
      const processAuthResult = function(authResult) {

        if (!authResultProcessed && (authResult || authResult === false)) {

          authResultProcessed = true;

          if (authResult) {

            try {
              process();
            } catch (error) {

              if (error.Fault !== undefined) {
                return self._sendError(error.Fault, callback, includeTimestamp);
              }

              return self._sendError({
                Code: {
                  Value: 'SOAP-ENV:Server',
                  Subcode: { value: 'InternalServerError' }
                },
                Reason: { Text: error.toString() },
                statusCode: 500
              }, callback, includeTimestamp);
            }

          } else {

            return self._sendError({
              Code: {
                Value: 'SOAP-ENV:Client',
                Subcode: { value: 'AuthenticationFailure' }
              },
              Reason: { Text: 'Invalid username or password' },
              statusCode: 401
            }, callback, includeTimestamp);
          }
        }
      };

      processAuthResult(authenticate(obj.Header && obj.Header.Security, processAuthResult));

    } else {
      throw new Error('Invalid authenticate function (not a function)');
    }
  };

  _executeMethod(options, req, callback, includeTimestamp) {
    options = options || {};
    const self = this;
    let method;
    let body;
    let headers;
    const { serviceName, portName, methodName, outputName, args, style } = options;
    let handled = false;

    if (this.soapHeaders) {
      headers = this.soapHeaders.map(header => {
        if (typeof header === 'function') {
          return header(methodName, args, options.headers, req);
        } else {
          return header;
        }
      }).join('\n');
    }

    try {
      method = this.services[serviceName][portName][methodName];
    } catch (error) {
      return callback(this._envelope('', headers, includeTimestamp));
    }

    function handleResult(error, result) {
      if (handled)
      {return;}
      handled = true;

      if (error && error.Fault !== undefined) {
        return self._sendError(error.Fault, callback, includeTimestamp);
      }
      else if (result === undefined) {
        // Backward compatibility to support one argument callback style
        result = error;
      }

      if (style === 'rpc') {
        body = self.wsdl.objectToRpcXML(outputName, result, '', self.wsdl.definitions.$targetNamespace);
      } else {
        const element = self.wsdl.definitions.services[serviceName].ports[portName].binding.methods[methodName].output;
        body = self.wsdl.objectToDocumentXML(outputName, result, element.targetNSAlias, element.targetNamespace);
      }
      callback(self._envelope(body, headers, includeTimestamp));
    }

    if (!self.wsdl.definitions.services[serviceName].ports[portName].binding.methods[methodName].output) {
      // no output defined = one-way operation so return empty response
      handled = true;
      body = '';
      if (this.onewayOptions.emptyBody) {
        body = self._envelope('', headers, includeTimestamp);
      }
      callback(body, this.onewayOptions.responseCode);
    }

    const result = method(args, handleResult, options.headers, req);
    if (typeof result !== 'undefined') {
      handleResult(result);
    }
  };

  _envelope(body, headers, includeTimestamp) {
    const defs = this.wsdl.definitions;
    const ns = defs.$targetNamespace;
    const encoding = '';
    const alias = findPrefix(defs.xmlns, ns);

    const envelopeDefinition = this.wsdl.options.forceSoap12Headers
      ? 'http://www.w3.org/2003/05/soap-envelope'
      : 'http://schemas.xmlsoap.org/soap/envelope/'

    let xml = `${'<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:soap="'}${envelopeDefinition}" ${
      encoding
    }${this.wsdl.xmlnsInEnvelope}>`;

    headers = headers || '';

    if (includeTimestamp) {
      const now = new Date();
      const created = getDate(now);
      const expires = getDate(new Date(now.getTime() + (1000 * 600)));

      headers += `${'<o:Security soap:mustUnderstand="1" ' +
        'xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" ' +
        'xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' +
        '    <u:Timestamp u:Id="_0">' +
        '      <u:Created>'}${created}</u:Created>` +
        `      <u:Expires>${expires}</u:Expires>` +
        '    </u:Timestamp>' +
        '  </o:Security>\n';
    }

    if (headers !== '') {
      xml += `<soap:Header>${headers}</soap:Header>`;
    }

    xml += body ? `<soap:Body>${body}</soap:Body>` : '<soap:Body/>';

    xml += '</soap:Envelope>';
    return xml;
  };

  _sendError(soapFault, callback, includeTimestamp) {
    const self = this;
    let fault;

    let statusCode;
    if (soapFault.statusCode) {
      ({ statusCode } = soapFault);
      soapFault.statusCode = undefined;
    }

    if (soapFault.faultcode) {
      // Soap 1.1 error style
      // Root element will be prependend with the soap NS
      // It must match the NS defined in the Envelope (set by the _envelope method)
      fault = self.wsdl.objectToDocumentXML('soap:Fault', soapFault, undefined);
    }
    else {
      // Soap 1.2 error style.
      // 3rd param is the NS prepended to all elements
      // It must match the NS defined in the Envelope (set by the _envelope method)
      fault = self.wsdl.objectToDocumentXML('Fault', soapFault, 'soap');
    }

    return callback(self._envelope(fault, '', includeTimestamp), statusCode);
  };
}

exports.Server = Server;
