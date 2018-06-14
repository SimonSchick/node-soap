'use strict';

const request = require('request');
const assert = require('assert');
const express = require('express');
const bodyParser = require('body-parser');
const soap = require('../');
let expressServer;
let server;
let port;
let url;
const wsdl = '<definitions name="HelloService" targetNamespace="http://www.examples.com/wsdl/HelloService.wsdl" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:tns="http://www.examples.com/wsdl/HelloService.wsdl" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><message name="SayHelloRequest"><part name="firstName" type="xsd:string"/></message><message name="SayHelloResponse"><part name="greeting" type="xsd:string"/></message><portType name="Hello_PortType"><operation name="sayHello"><input message="tns:SayHelloRequest"/><output message="tns:SayHelloResponse"/></operation></portType><binding name="Hello_Binding" type="tns:Hello_PortType"><soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/><operation name="sayHello"><soap:operation soapAction="sayHello"/><input><soap:body encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" namespace="urn:examples:helloservice" use="encoded"/></input><output><soap:body encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" namespace="urn:examples:helloservice" use="encoded"/></output></operation></binding><service name="Hello_Service"><documentation>WSDL File for HelloService</documentation><port binding="tns:Hello_Binding" name="Hello_Port"><soap:address location="http://localhost:51515/SayHello/" /></port></service></definitions>';
const requestXML = '<Envelope xmlns="http://schemas.xmlsoap.org/soap/envelope/">' +
  '<Body>' +
  '<sayHello xmlns="http://www.examples.com/wsdl/HelloService.wsdl">' +
  '<firstName>tarun</firstName>' +
  '</sayHello>' +
  '</Body>' +
  '</Envelope>';
const responseXML = '<?xml version="1.0" encoding="utf-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"  xmlns:tns="http://www.examples.com/wsdl/HelloService.wsdl">' +
  '<soap:Body>' +
  '<tns:sayHelloResponse>' +
  '<tns:greeting>tarun</tns:greeting>' +
  '</tns:sayHelloResponse>' +
  '</soap:Body>' +
  '</soap:Envelope>';

describe('Express server without middleware', () => {

  before(done => {
    const service = {
      Hello_Service: {
        Hello_Port: {
          sayHello(args) {
            return {
              greeting: args.firstName
            };
          }
        }
      }
    };

    expressServer = express();
    server = expressServer.listen(51515, () => {
      soap.listen(expressServer, '/SayHello', service, wsdl);
      url = `http://${server.address().address}:${server.address().port}`;
      if (server.address().address === '0.0.0.0' || server.address().address === '::') {
        url = `http://127.0.0.1:${server.address().port}`;
      }
      done();
    });
  });

  after(() => {
    server.close();
  });

  it('should handle body without middleware', done => {
    request({
      url: `${url}/SayHello`,
      method: 'POST',
      headers: {
        SOAPAction: 'sayHello',
        'Content-Type': 'text/xml; charset="utf-8"'
      },
      body: requestXML
    }, (err, response, body) => {
      if (err) {
        throw err;
      }
      assert.equal(body, responseXML);
      done();
    });
  });

  it('should serve wsdl', done => {
    request({
      url: `${url}/SayHello?wsdl`,
      method: 'GET',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"'
      }
    }, (err, response, body) => {
      if (err) {
        throw err;
      }
      assert.equal(body, wsdl);
      done();
    });
  });

  it('should handle other routes as usual', done => {
    expressServer.route('/test/r1').get((req, res, next) => {
      // make sure next() works as well
      return next();
    }, (req, res) => {
      return res.status(200).send('test passed');
    });

    request({
      url: `${url}/test/r1`,
      method: 'GET'
    }, (err, response, body) => {
      if (err) {
        throw err;
      }
      assert.equal(body, 'test passed');
      done();
    });
  });

});

describe('Express server with middleware', () => {

  before(done => {
    const wsdl = '<definitions name="HelloService" targetNamespace="http://www.examples.com/wsdl/HelloService.wsdl" xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:tns="http://www.examples.com/wsdl/HelloService.wsdl" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><message name="SayHelloRequest"><part name="firstName" type="xsd:string"/></message><message name="SayHelloResponse"><part name="greeting" type="xsd:string"/></message><portType name="Hello_PortType"><operation name="sayHello"><input message="tns:SayHelloRequest"/><output message="tns:SayHelloResponse"/></operation></portType><binding name="Hello_Binding" type="tns:Hello_PortType"><soap:binding style="rpc" transport="http://schemas.xmlsoap.org/soap/http"/><operation name="sayHello"><soap:operation soapAction="sayHello"/><input><soap:body encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" namespace="urn:examples:helloservice" use="encoded"/></input><output><soap:body encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" namespace="urn:examples:helloservice" use="encoded"/></output></operation></binding><service name="Hello_Service"><documentation>WSDL File for HelloService</documentation><port binding="tns:Hello_Binding" name="Hello_Port"><soap:address location="http://localhost:51515/SayHello/" /></port></service></definitions>';
    const service = {
      Hello_Service: {
        Hello_Port: {
          sayHello(args) {
            return {
              greeting: args.firstName
            };
          }
        }
      }
    };
    expressServer = express();
    expressServer.use(bodyParser.raw({ type() { return true; }, limit: '5mb' }));

    server = expressServer.listen(51515, () => {

      const soapServer = soap.listen(expressServer, '/SayHello', service, wsdl);
      url = `http://${server.address().address}:${server.address().port}`;

      if (server.address().address === '0.0.0.0' || server.address().address === '::') {
        url = `http://127.0.0.1:${server.address().port}`;
      }

      done();
    });
  });

  after(() => {
    server.close();
  });

  it('should allow parsing body via express middleware', done => {
    request({
      url: `${url}/SayHello`,
      method: 'POST',
      headers: {
        SOAPAction: 'sayHello',
        'Content-Type': 'text/xml; charset="utf-8"'
      },
      body: requestXML
    }, (err, response, body) => {
      if (err) {
        throw err;
      }
      assert.equal(body, responseXML);
      done();
    });
  });

});
