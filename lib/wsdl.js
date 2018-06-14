/*
 * Copyright (c) 2011 Vinay Pulim <vinay@milewise.com>
 * MIT Licensed
 *
 */
/* jshint proto:true*/

'use strict';

const sax = require('sax');
const HttpClient = require('./http');
const NamespaceContext = require('./nscontext');
const fs = require('fs');
const url = require('url');
const path = require('path');
const assert = require('assert').ok;
const stripBom = require('strip-bom');
const debug = require('debug')('node-soap');
const { merge, mergeWith, defaultsDeep } = require('lodash');
const utils = require('./utils');
const { TNS_PREFIX, findPrefix } = utils;

const Primitives = {
  string: 1,
  boolean: 1,
  decimal: 1,
  float: 1,
  double: 1,
  anyType: 1,
  byte: 1,
  int: 1,
  long: 1,
  short: 1,
  negativeInteger: 1,
  nonNegativeInteger: 1,
  positiveInteger: 1,
  nonPositiveInteger:1,
  unsignedByte: 1,
  unsignedInt: 1,
  unsignedLong: 1,
  unsignedShort: 1,
  duration: 0,
  dateTime: 0,
  time: 0,
  date: 0,
  gYearMonth: 0,
  gYear: 0,
  gMonthDay: 0,
  gDay: 0,
  gMonth: 0,
  hexBinary: 0,
  base64Binary: 0,
  anyURI: 0,
  QName: 0,
  NOTATION: 0
};

function splitQName(nsName) {
  const i = typeof nsName === 'string' ? nsName.indexOf(':') : -1;
  return i < 0 ? {
    prefix: TNS_PREFIX,
    name: nsName
  } : {
    prefix: nsName.substring(0, i),
    name: nsName.substring(i + 1)
  };
}

function xmlEscape(obj) {
  if (typeof (obj) === 'string') {
    if (obj.substr(0, 9) === '<![CDATA[' && obj.substr(-3) === ']]>') {
      return obj;
    }
    return obj
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  return obj;
}

const trimLeft = /^[\s\xA0]+/;
const trimRight = /[\s\xA0]+$/;

function trim(text) {
  return text.replace(trimLeft, '').replace(trimRight, '');
}

function deepMerge(destination, source) {
  return mergeWith(destination || {}, source, (a, b) => {
    return Array.isArray(a) ? a.concat(b) : undefined;
  });
}

class Element {
  constructor(nsName, attrs, options) {
    const parts = splitQName(nsName);

    this.nsName = nsName;
    this.prefix = parts.prefix;
    this.name = parts.name;
    this.children = [];
    this.xmlns = {};

    this._initializeOptions(options);

    for (const key in attrs) {
      const match = /^xmlns:?(.*)$/.exec(key);
      if (match) {
        this.xmlns[match[1] ? match[1] : TNS_PREFIX] = attrs[key];
      }
      else {
        if (key === 'value') {
          this[this.valueKey] = attrs[key];
        } else {
          this[`$${key}`] = attrs[key];
        }
      }
    }
    if (this.$targetNamespace !== undefined) {
      // Add targetNamespace to the mapping
      this.xmlns[TNS_PREFIX] = this.$targetNamespace;
    }
  }

  _initializeOptions(options) {
    if (options) {
      this.valueKey = options.valueKey || '$value';
      this.xmlKey = options.xmlKey || '$xml';
      this.ignoredNamespaces = options.ignoredNamespaces || [];
    } else {
      this.valueKey = '$value';
      this.xmlKey = '$xml';
      this.ignoredNamespaces = [];
    }
  }

  deleteFixedAttrs() {
    if (this.children && this.children.length === 0) {
      delete this.children;
    }
    if (this.xmlns && Object.keys(this.xmlns).length === 0) {
       delete this.xmlns;
    }
    delete this.nsName;
    delete this.prefix;
    delete this.name;
  }

  startElement(stack, nsName, attrs, options) {
    if (!this.allowedChildren) {
      return;
    }

    const ChildClass = this.allowedChildren[splitQName(nsName).name];

    if (ChildClass) {
      stack.push(new ChildClass(nsName, attrs, options));
    }
    else {
      this.unexpected(nsName);
    }

  }

  endElement(stack, nsName) {
    if (this.nsName === nsName) {
      if (stack.length < 2) {
        return;
      }
      const parent = stack[stack.length - 2];
      if (this !== stack[0]) {
        defaultsDeep(stack[0].xmlns, this.xmlns);
        // delete this.xmlns;
        parent.children.push(this);
        parent.addChild(this);
      }
      stack.pop();
    }
  }

  addChild() {
    // Noop
  }

  unexpected(name) {
    throw new Error(`Found unexpected element (${name}) inside ${this.nsName}`);
  }

  description() {
    return this.$name || this.name;
  }

  init() {
    // Noop
  }

  static createSubClass() {
    return class extends Element {
      constructor(nsName, attrs, options) {
        super(nsName, attrs, options);
        this.init();
      }
    };
  }
}
Element.prototype.allowedChildren = [];


const ElementElement = Element.createSubClass();
const AnyElement = Element.createSubClass();
const InputElement = Element.createSubClass();
const OutputElement = Element.createSubClass();
const SimpleTypeElement = Element.createSubClass();
const RestrictionElement = Element.createSubClass();
const ExtensionElement = Element.createSubClass();
const ChoiceElement = Element.createSubClass();
const EnumerationElement = Element.createSubClass();
const ComplexTypeElement = Element.createSubClass();
const ComplexContentElement = Element.createSubClass();
const SimpleContentElement = Element.createSubClass();
const SequenceElement = Element.createSubClass();
const AllElement = Element.createSubClass();
const MessageElement = Element.createSubClass();
const DocumentationElement = Element.createSubClass();

const SchemaElement = Element.createSubClass();
const TypesElement = Element.createSubClass();
const OperationElement = Element.createSubClass();
const PortTypeElement = Element.createSubClass();
const BindingElement = Element.createSubClass();
const PortElement = Element.createSubClass();
const ServiceElement = Element.createSubClass();
const DefinitionsElement = Element.createSubClass();

const ElementTypeMap = {
  types: [TypesElement, 'schema documentation'],
  schema: [SchemaElement, 'element complexType simpleType include import'],
  element: [ElementElement, 'annotation complexType'],
  any: [AnyElement, ''],
  simpleType: [SimpleTypeElement, 'restriction'],
  restriction: [RestrictionElement, 'enumeration all choice sequence'],
  extension: [ExtensionElement, 'all sequence choice'],
  choice: [ChoiceElement, 'element sequence choice any'],
  // group: [GroupElement, 'element group'],
  enumeration: [EnumerationElement, ''],
  complexType: [ComplexTypeElement, 'annotation sequence all complexContent simpleContent choice'],
  complexContent: [ComplexContentElement, 'extension'],
  simpleContent: [SimpleContentElement, 'extension'],
  sequence: [SequenceElement, 'element sequence choice any'],
  all: [AllElement, 'element choice'],

  service: [ServiceElement, 'port documentation'],
  port: [PortElement, 'address documentation'],
  binding: [BindingElement, '_binding SecuritySpec operation documentation'],
  portType: [PortTypeElement, 'operation documentation'],
  message: [MessageElement, 'part documentation'],
  operation: [OperationElement, 'documentation input output fault _operation'],
  input: [InputElement, 'body SecuritySpecRef documentation header'],
  output: [OutputElement, 'body SecuritySpecRef documentation header'],
  fault: [Element, '_fault documentation'],
  definitions: [DefinitionsElement, 'types message portType binding service import documentation'],
  documentation: [DocumentationElement, '']
};

function mapElementTypes(types) {
  const rtn = {};
  types = types.split(' ');
  types.forEach(type => {
    // eslint-disable-next-line
    rtn[type.replace(/^_/, '')] = (ElementTypeMap[type] || [Element]) [0];
  });
  return rtn;
}

for (const n in ElementTypeMap) {
  const v = ElementTypeMap[n];
  v[0].prototype.allowedChildren = mapElementTypes(v[1]);
}

MessageElement.prototype.init = function() {
  this.element = null;
  this.parts = null;
};

SchemaElement.prototype.init = function() {
  this.complexTypes = {};
  this.types = {};
  this.elements = {};
  this.includes = [];
};

TypesElement.prototype.init = function() {
  this.schemas = {};
};

OperationElement.prototype.init = function() {
  this.input = null;
  this.output = null;
  this.inputSoap = null;
  this.outputSoap = null;
  this.style = '';
  this.soapAction = '';
};

PortTypeElement.prototype.init = function() {
  this.methods = {};
};

BindingElement.prototype.init = function() {
  this.transport = '';
  this.style = '';
  this.methods = {};
};

PortElement.prototype.init = function() {
  this.location = null;
};

ServiceElement.prototype.init = function() {
  this.ports = {};
};

DefinitionsElement.prototype.init = function() {
  if (this.name !== 'definitions') {
    this.unexpected(this.nsName);
  }
  this.messages = {};
  this.portTypes = {};
  this.bindings = {};
  this.services = {};
  this.schemas = {};
};

DocumentationElement.prototype.init = function() {
};

SchemaElement.prototype.merge = function(source) {
  assert(source instanceof SchemaElement);
  if (this.$targetNamespace === source.$targetNamespace) {
    merge(this.complexTypes, source.complexTypes);
    merge(this.types, source.types);
    merge(this.elements, source.elements);
    merge(this.xmlns, source.xmlns);
  }
  return this;
};


SchemaElement.prototype.addChild = function(child) {
  if (child.$name in Primitives) {
    return;
  }
  if (child.name === 'include' || child.name === 'import') {
    const location = child.$schemaLocation || child.$location;
    if (location) {
      this.includes.push({
        namespace: child.$namespace || child.$targetNamespace || this.$targetNamespace,
        location
      });
    }
  } else if (child.name === 'complexType') {
    this.complexTypes[child.$name] = child;
  } else if (child.name === 'element') {
    this.elements[child.$name] = child;
  } else if (child.$name) {
    this.types[child.$name] = child;
  }
  this.children.pop();
};
// Fixes #325
TypesElement.prototype.addChild = function(child) {
  assert(child instanceof SchemaElement);

  const targetNamespace = child.$targetNamespace;

  if (this.schemas.hasOwnProperty(targetNamespace)) {
    throw new Error(`Target-Namespace "${targetNamespace}" already in use by another Schema!`);
  }
  this.schemas[targetNamespace] = child;
};

InputElement.prototype.addChild = function(child) {
  if (child.name === 'body') {
    this.use = child.$use;
    if (this.use === 'encoded') {
      this.encodingStyle = child.$encodingStyle;
    }
    this.children.pop();
  }
};

OutputElement.prototype.addChild = function(child) {
  if (child.name === 'body') {
    this.use = child.$use;
    if (this.use === 'encoded') {
      this.encodingStyle = child.$encodingStyle;
    }
    this.children.pop();
  }
};

OperationElement.prototype.addChild = function(child) {
  if (child.name === 'operation') {
    this.soapAction = child.$soapAction || '';
    this.style = child.$style || '';
    this.children.pop();
  }
};

BindingElement.prototype.addChild = function(child) {
  if (child.name === 'binding') {
    this.transport = child.$transport;
    this.style = child.$style;
    this.children.pop();
  }
};

PortElement.prototype.addChild = function(child) {
  if (child.name === 'address' && typeof child.$location !== 'undefined') {
    this.location = child.$location;
  }
};

DefinitionsElement.prototype.addChild = function(child) {
  if (child instanceof TypesElement) {
    // Merge types.schemas into definitions.schemas
    merge(this.schemas, child.schemas);
  } else if (child instanceof MessageElement) {
    this.messages[child.$name] = child;
  } else if (child.name === 'import') {
    this.schemas[child.$namespace] = new SchemaElement(child.$namespace, {});
    this.schemas[child.$namespace].addChild(child);
  } else if (child instanceof PortTypeElement) {
    this.portTypes[child.$name] = child;
  } else if (child instanceof BindingElement) {
    if (child.transport === 'http://schemas.xmlsoap.org/soap/http' ||
      child.transport === 'http://www.w3.org/2003/05/soap/bindings/HTTP/') {
      this.bindings[child.$name] = child;
    }
  } else if (child instanceof ServiceElement) {
    this.services[child.$name] = child;
  }
  this.children.pop();
};

MessageElement.prototype.postProcess = function(definitions) {
  let part = null;
  let child;
  const children = this.children || [];
  let ns;
  let nsName;
  let i;
  let type;

  for (i in children) {
    if ((child = children[i]).name === 'part') {
      part = child;
      break;
    }
  }

  if (!part) {
    return;
  }

  if (part.$element) {
    let lookupTypes = [];

    delete this.parts;

    nsName = splitQName(part.$element);
    ns = nsName.prefix;
    let schema = definitions.schemas[definitions.xmlns[ns]];
    this.element = schema.elements[nsName.name];
    if (!this.element) {
      debug(`${nsName.name} is not present in wsdl and cannot be processed correctly.`);
      return;
    }
    this.element.targetNSAlias = ns;
    this.element.targetNamespace = definitions.xmlns[ns];

    // set the optional $lookupType to be used within `client#_invoke()` when
    // calling `wsdl#objectToDocumentXML()
    this.element.$lookupType = part.$element;

    const elementChildren = this.element.children;

    // get all nested lookup types (only complex types are followed)
    if (elementChildren.length > 0) {
      for (i = 0; i < elementChildren.length; i++) {
        lookupTypes.push(this._getNestedLookupTypeString(elementChildren[i]));
      }
    }

    // if nested lookup types where found, prepare them for furter usage
    if (lookupTypes.length > 0) {
      lookupTypes = lookupTypes.
        join('_').
        split('_').
        filter(type => {
          return type !== '^';
        });

      const schemaXmlns = definitions.schemas[this.element.targetNamespace].xmlns;

      for (i = 0; i < lookupTypes.length; i++) {
        lookupTypes[i] = this._createLookupTypeObject(lookupTypes[i], schemaXmlns);
      }
    }

    this.element.$lookupTypes = lookupTypes;

    if (this.element.$type) {
      type = splitQName(this.element.$type);
      const typeNs = schema.xmlns && schema.xmlns[type.prefix] || definitions.xmlns[type.prefix];

      if (typeNs) {
        if (type.name in Primitives) {
          // this.element = this.element.$type;
        }
        else {
          // first check local mapping of ns alias to namespace
          schema = definitions.schemas[typeNs];
          const ctype = schema.complexTypes[type.name] || schema.types[type.name] || schema.elements[type.name];


          if (ctype) {
            this.parts = ctype.description(definitions, schema.xmlns);
          }
        }
      }
    }
    else {
      const method = this.element.description(definitions, schema.xmlns);
      this.parts = method[nsName.name];
    }


    this.children.splice(0, 1);
  } else {
    // rpc encoding
    this.parts = {};
    delete this.element;
    for (i = 0; part = this.children[i]; i++) {
      if (part.name === 'documentation') {
        // <wsdl:documentation can be present under <wsdl:message>
        continue;
      }
      assert(part.name === 'part', 'Expected part element');
      nsName = splitQName(part.$type);
      ns = definitions.xmlns[nsName.prefix];
      type = nsName.name;
      const schemaDefinition = definitions.schemas[ns];
      if (typeof schemaDefinition !== 'undefined') {
        this.parts[part.$name] = definitions.schemas[ns].types[type] || definitions.schemas[ns].complexTypes[type];
      } else {
        this.parts[part.$name] = part.$type;
      }

      if (typeof this.parts[part.$name] === 'object') {
        this.parts[part.$name].prefix = nsName.prefix;
        this.parts[part.$name].xmlns = ns;
      }

      this.children.splice(i--, 1);
    }
  }
  this.deleteFixedAttrs();
};

/**
 * Takes a given namespaced String(for example: 'alias:property') and creates a lookupType
 * object for further use in as first (lookup) `parameterTypeObj` within the `objectToXML`
 * method and provides an entry point for the already existing code in `findChildSchemaObject`.
 *
 * @method _createLookupTypeObject
 * @param {String}            nsString          The NS String (for example "alias:type").
 * @param {Object}            xmlns       The fully parsed `wsdl` definitions object (including all schemas).
 * @returns {Object}
 * @private
 */
MessageElement.prototype._createLookupTypeObject = function(nsString, xmlns) {
  const splittedNSString = splitQName(nsString);
  const nsAlias = splittedNSString.prefix;
  const [type, name] = splittedNSString.name.split('#');
  const lookupTypeObj = {};

  lookupTypeObj.$namespace = xmlns[nsAlias];
  lookupTypeObj.$type = `${nsAlias}:${type}`;
  lookupTypeObj.$name = name;

  return lookupTypeObj;
};

/**
 * Iterates through the element and every nested child to find any defined `$type`
 * property and returns it in a underscore ('_') separated String (using '^' as default
 * value if no `$type` property was found).
 *
 * @method _getNestedLookupTypeString
 * @param {Object}            element         The element which (probably) contains nested `$type` values.
 * @returns {String}
 * @private
 */
MessageElement.prototype._getNestedLookupTypeString = function(element) {
  let resolvedType = '^';
  const excluded = this.ignoredNamespaces.concat('xs'); // Do not process $type values wich start with

  if (element.hasOwnProperty('$type') && typeof element.$type === 'string') {
    if (excluded.indexOf(element.$type.split(':')[0]) === -1) {
      resolvedType += `_${element.$type}#${element.$name}`;
    }
  }

  if (element.children.length > 0) {
    element.children.forEach(child => {
      const resolvedChildType = this._getNestedLookupTypeString(child).replace(/\^_/, '');

      if (resolvedChildType && typeof resolvedChildType === 'string') {
        resolvedType += `_${resolvedChildType}`;
      }
    });
  }

  return resolvedType;
};

OperationElement.prototype.postProcess = function(definitions, tag) {
  const { children } = this;
  for (let i = 0, child; child = children[i]; i++) {
    if (child.name !== 'input' && child.name !== 'output')
    {continue;}
    if (tag === 'binding') {
      this[child.name] = child;
      children.splice(i--, 1);
      continue;
    }
    const messageName = splitQName(child.$message).name;
    const message = definitions.messages[messageName];
    message.postProcess(definitions);
    if (message.element) {
      definitions.messages[message.element.$name] = message;
      this[child.name] = message.element;
    }
    else {
      this[child.name] = message;
    }
    children.splice(i--, 1);
  }
  this.deleteFixedAttrs();
};

PortTypeElement.prototype.postProcess = function(definitions) {
  const { children } = this;
  if (typeof children === 'undefined')
  {return;}
  for (let i = 0, child; child = children[i]; i++) {
    if (child.name !== 'operation')
    {continue;}
    child.postProcess(definitions, 'portType');
    this.methods[child.$name] = child;
    children.splice(i--, 1);
  }
  delete this.$name;
  this.deleteFixedAttrs();
};

BindingElement.prototype.postProcess = function(definitions) {
  const type = splitQName(this.$type).name;
  const portType = definitions.portTypes[type];
  const { children, style } = this;
  if (portType){
    portType.postProcess(definitions);
    this.methods = portType.methods;

    for (let i = 0, child; child = children[i]; i++) {
      if (child.name !== 'operation')
      {continue;}
      child.postProcess(definitions, 'binding');
      children.splice(i--, 1);
      child.style || (child.style = style);
      const method = this.methods[child.$name];

      if (method) {
        method.style = child.style;
        method.soapAction = child.soapAction;
        method.inputSoap = child.input || null;
        method.outputSoap = child.output || null;
        method.inputSoap && method.inputSoap.deleteFixedAttrs();
        method.outputSoap && method.outputSoap.deleteFixedAttrs();
      }
    }
  }
  delete this.$name;
  delete this.$type;
  this.deleteFixedAttrs();
};

ServiceElement.prototype.postProcess = function(definitions) {
  const { children } = this;
  const { bindings } = definitions;
  if (children && children.length > 0) {
    for (let i = 0, child; child = children[i]; i++) {
      if (child.name !== 'port')
      {continue;}
      const bindingName = splitQName(child.$binding).name;
      const binding = bindings[bindingName];
      if (binding) {
        binding.postProcess(definitions);
        this.ports[child.$name] = {
          location: child.location,
          binding
        };
        children.splice(i--, 1);
      }
    }
  }
  delete this.$name;
  this.deleteFixedAttrs();
};


SimpleTypeElement.prototype.description = function(definitions) {
  const { children } = this;
  for (let i = 0, child; child = children[i]; i++) {
    if (child instanceof RestrictionElement)
    {return `${this.$name}|${child.description()}`;}
  }
  return {};
};

RestrictionElement.prototype.description = function(definitions, xmlns) {
  const { children } = this;
  let desc;
  for (let i = 0, child; child = children[i]; i++) {
    if (child instanceof SequenceElement ||
            child instanceof ChoiceElement) {
      desc = child.description(definitions, xmlns);
      break;
    }
  }
  if (desc && this.$base) {
    const type = splitQName(this.$base);
    const typeName = type.name;
    const ns = xmlns && xmlns[type.prefix] || definitions.xmlns[type.prefix];
    const schema = definitions.schemas[ns];
    const typeElement = schema && (schema.complexTypes[typeName] || schema.types[typeName] || schema.elements[typeName]);

    desc.getBase = function() {
      return typeElement.description(definitions, schema.xmlns);
    };
    return desc;
  }

  // then simple element
  const base = this.$base ? `${this.$base}|` : '';
  return base + this.children.map(child => {
    return child.description();
  }).join(',');
};

ExtensionElement.prototype.description = function(definitions, xmlns) {
  const { children } = this;
  let desc = {};
  for (let i = 0, child; child = children[i]; i++) {
    if (child instanceof SequenceElement ||
      child instanceof ChoiceElement) {
      desc = child.description(definitions, xmlns);
    }
  }
  if (this.$base) {
    const type = splitQName(this.$base);
    const typeName = type.name;
    const ns = xmlns && xmlns[type.prefix] || definitions.xmlns[type.prefix];
    const schema = definitions.schemas[ns];

    if (typeName in Primitives) {
      return this.$base;
    }
    const typeElement = schema && (schema.complexTypes[typeName] ||
      schema.types[typeName] || schema.elements[typeName]);

    if (typeElement) {
      const base = typeElement.description(definitions, schema.xmlns);
      desc = defaultsDeep(base, desc);
    }
  }
  return desc;
};

EnumerationElement.prototype.description = function() {
  return this[this.valueKey];
};

ComplexTypeElement.prototype.description = function(definitions, xmlns) {
  const children = this.children || [];
  for (let i = 0, child; child = children[i]; i++) {
    if (child instanceof ChoiceElement ||
      child instanceof SequenceElement ||
      child instanceof AllElement ||
      child instanceof SimpleContentElement ||
      child instanceof ComplexContentElement) {

      return child.description(definitions, xmlns);
    }
  }
  return {};
};

ComplexContentElement.prototype.description = function(definitions, xmlns) {
  const { children } = this;
  for (let i = 0, child; child = children[i]; i++) {
    if (child instanceof ExtensionElement) {
      return child.description(definitions, xmlns);
    }
  }
  return {};
};

SimpleContentElement.prototype.description = function(definitions, xmlns) {
  const { children } = this;
  for (let i = 0, child; child = children[i]; i++) {
    if (child instanceof ExtensionElement) {
      return child.description(definitions, xmlns);
    }
  }
  return {};
};

ElementElement.prototype.description = function(definitions, xmlns) {
  let element = {};
  let name = this.$name;
  const isMany = !this.$maxOccurs ? false : (isNaN(this.$maxOccurs) ? (this.$maxOccurs === 'unbounded') : (this.$maxOccurs > 1));
  if (this.$minOccurs !== this.$maxOccurs && isMany) {
    name += '[]';
  }

  if (xmlns && xmlns[TNS_PREFIX]) {
    this.$targetNamespace = xmlns[TNS_PREFIX];
  }
  let type = this.$type || this.$ref;
  if (type) {
    type = splitQName(type);
    const typeName = type.name;
    const ns = xmlns && xmlns[type.prefix] || definitions.xmlns[type.prefix];
    const schema = definitions.schemas[ns];
    const typeElement = schema && (this.$type ? schema.complexTypes[typeName] || schema.types[typeName] : schema.elements[typeName]);

    if (ns && definitions.schemas[ns]) {
      ({ xmlns } = definitions.schemas[ns]);
    }

    if (typeElement && !(typeName in Primitives)) {

      if (!(typeName in definitions.descriptions.types)) {

        let elem = {};
        definitions.descriptions.types[typeName] = elem;
        const description = typeElement.description(definitions, xmlns);
        if (typeof description === 'string') {
          elem = description;
        }
        else {
          Object.keys(description).forEach(key => {
            elem[key] = description[key];
          });
        }

        if (this.$ref) {
          element = elem;
        }
        else {
          element[name] = elem;
        }

        if (typeof elem === 'object') {
          elem.targetNSAlias = type.prefix;
          elem.targetNamespace = ns;
        }

        definitions.descriptions.types[typeName] = elem;
      }
      else {
        if (this.$ref) {
          element = definitions.descriptions.types[typeName];
        }
        else {
          element[name] = definitions.descriptions.types[typeName];
        }
      }

    }
    else {
      element[name] = this.$type;
    }
  }
  else {
    const { children } = this;
    element[name] = {};
    for (let i = 0, child; child = children[i]; i++) {
      if (child instanceof ComplexTypeElement) {
        element[name] = child.description(definitions, xmlns);
      }
    }
  }
  return element;
};

AllElement.prototype.description = SequenceElement.prototype.description = function(definitions, xmlns) {
  const { children } = this;
  const sequence = {};
  for (let i = 0, child; child = children[i]; i++) {
    if (child instanceof AnyElement) {
      continue;
    }
    const description = child.description(definitions, xmlns);
    for (const key in description) {
      sequence[key] = description[key];
    }
  }
  return sequence;
};

ChoiceElement.prototype.description = function(definitions, xmlns) {
  const { children } = this;
  const choice = {};
  for (let i = 0, child; child = children[i]; i++) {
    const description = child.description(definitions, xmlns);
    for (const key in description) {
      choice[key] = description[key];
    }
  }
  return choice;
};

MessageElement.prototype.description = function(definitions) {
  if (this.element) {
    return this.element && this.element.description(definitions);
  }
  const desc = {};
  desc[this.$name] = this.parts;
  return desc;
};

PortTypeElement.prototype.description = function(definitions) {
  const methods = {};
  for (const name in this.methods) {
    const method = this.methods[name];
    methods[name] = method.description(definitions);
  }
  return methods;
};

OperationElement.prototype.description = function(definitions) {
  const inputDesc = this.input ? this.input.description(definitions) : null;
  const outputDesc = this.output ? this.output.description(definitions) : null;
  return {
    input: inputDesc && inputDesc[Object.keys(inputDesc)[0]],
    output: outputDesc && outputDesc[Object.keys(outputDesc)[0]]
  };
};

BindingElement.prototype.description = function(definitions) {
  const methods = {};
  for (const name in this.methods) {
    const method = this.methods[name];
    methods[name] = method.description(definitions);
  }
  return methods;
};

ServiceElement.prototype.description = function(definitions) {
  const ports = {};
  for (const name in this.ports) {
    const port = this.ports[name];
    ports[name] = port.binding.description(definitions);
  }
  return ports;
};

function appendColon(ns) {
  return (ns && ns.charAt(ns.length - 1) !== ':') ? `${ns}:` : ns;
}

function noColonNameSpace(ns) {
  return (ns && ns.charAt(ns.length - 1) === ':') ? ns.substring(0, ns.length - 1) : ns;
}

class WSDL {
  constructor(definition, uri, options) {
    let fromFunc;

    this.uri = uri;
    this.callback = () => {
      // Noop
    };
    this._includesWsdl = [];

    // Initialize WSDL cache
    this.WSDL_CACHE = (options || {}).WSDL_CACHE || {};

    this._initializeOptions(options);

    if (typeof definition === 'string') {
      definition = stripBom(definition);
      fromFunc = this._fromXML;
    }
    else if (typeof definition === 'object') {
      fromFunc = this._fromServices;
    }
    else {
      throw new Error('WSDL constructor takes either an XML string or service definition');
    }

    process.nextTick(() => {
      try {
        fromFunc.call(this, definition);
      } catch (e) {
        return this.callback(e.message);
      }

      this.processIncludes(err => {
        let name;
        if (err) {
          return this.callback(err);
        }

        this.definitions.deleteFixedAttrs();
        const services = this.services = this.definitions.services;
        if (services) {
          for (name in services) {
            services[name].postProcess(this.definitions);
          }
        }
        const { complexTypes } = this.definitions;
        if (complexTypes) {
          for (name in complexTypes) {
            complexTypes[name].deleteFixedAttrs();
          }
        }

        // for document style, for every binding, prepare input message element name to (methodName, output message element name) mapping
        const { bindings } = this.definitions;
        for (const bindingName in bindings) {
          const binding = bindings[bindingName];
          if (typeof binding.style === 'undefined') {
            binding.style = 'document';
          }
          if (binding.style !== 'document') {
            continue;
          }
          const { methods } = binding;
          const topEls = binding.topElements = {};
          for (const methodName in methods) {
            if (methods[methodName].input) {
              const inputName = methods[methodName].input.$name;
              let outputName = '';
              if (methods[methodName].output)
              {outputName = methods[methodName].output.$name;}
              topEls[inputName] = { methodName, outputName };
            }
          }
        }

        // prepare soap envelope xmlns definition string
        this.xmlnsInEnvelope = this._xmlnsMap();

        this.callback(err, this);
      });

    });
  }

  _initializeOptions(options) {
    this._originalIgnoredNamespaces = (options || {}).ignoredNamespaces;
    this.options = {};

    const ignoredNamespaces = options ? options.ignoredNamespaces : null;

    if (ignoredNamespaces &&
        (Array.isArray(ignoredNamespaces.namespaces) || typeof ignoredNamespaces.namespaces === 'string')) {
      if (ignoredNamespaces.override) {
        this.options.ignoredNamespaces = ignoredNamespaces.namespaces;
      } else {
        this.options.ignoredNamespaces = this.ignoredNamespaces.concat(ignoredNamespaces.namespaces);
      }
    } else {
      this.options.ignoredNamespaces = this.ignoredNamespaces;
    }

    this.options.valueKey = options.valueKey || this.valueKey;
    this.options.xmlKey = options.xmlKey || this.xmlKey;
    if (options.escapeXML === undefined) {
      this.options.escapeXML = true;
    } else {
      this.options.escapeXML = options.escapeXML;
    }
    if (options.returnFault === undefined) {
      this.options.returnFault = false;
    } else {
      this.options.returnFault = options.returnFault;
    }
    this.options.handleNilAsNull = !!options.handleNilAsNull;

    if (options.namespaceArrayElements === undefined) {
      this.options.namespaceArrayElements = true;
    } else {
      this.options.namespaceArrayElements = options.namespaceArrayElements;
    }

    // Allow any request headers to keep passing through
    this.options.wsdl_headers = options.wsdl_headers;
    this.options.wsdl_options = options.wsdl_options;
    if (options.httpClient) {
      this.options.httpClient = options.httpClient;
    }

    // The supplied request-object should be passed through
    if (options.request) {
      this.options.request = options.request;
    }

    const ignoreBaseNameSpaces = options ? options.ignoreBaseNameSpaces : null;
    if (ignoreBaseNameSpaces !== null && typeof ignoreBaseNameSpaces !== 'undefined') {
      this.options.ignoreBaseNameSpaces = ignoreBaseNameSpaces;
    } else {
      this.options.ignoreBaseNameSpaces = this.ignoreBaseNameSpaces;
    }

    // Works only in client
    this.options.forceSoap12Headers = options.forceSoap12Headers;
    this.options.customDeserializer = options.customDeserializer;

    if (options.overrideRootElement !== undefined) {
      this.options.overrideRootElement = options.overrideRootElement;
    }

    this.options.useEmptyTag = !!options.useEmptyTag;
  }

  onReady(callback) {
    if (callback) {
      this.callback = callback;
    }
  }

  _processNextInclude(includes, callback) {
    const include = includes.shift();

    if (!include) {
      callback();
      return;
    }

    let includePath;
    if (!/^https?:/.test(this.uri) && !/^https?:/.test(include.location)) {
      includePath = path.resolve(path.dirname(this.uri), include.location);
    } else {
      includePath = url.resolve(this.uri || '', include.location);
    }

    const options = Object.assign({}, this.options);
    // Follow supplied ignoredNamespaces option
    options.ignoredNamespaces = this._originalIgnoredNamespaces || this.options.ignoredNamespaces;
    options.WSDL_CACHE = this.WSDL_CACHE;

    openWsdlRecursive(includePath, options, (err, wsdl) => {
      if (err) {
        return callback(err);
      }

      this._includesWsdl.push(wsdl);

      if (wsdl.definitions instanceof DefinitionsElement) {
        _.mergeWith(this.definitions, wsdl.definitions, (a, b) => {
          return (a instanceof SchemaElement) ? a.merge(b) : undefined;
        });
      } else {
        this.definitions.schemas[include.namespace || wsdl.definitions.$targetNamespace] = deepMerge(this.definitions.schemas[include.namespace || wsdl.definitions.$targetNamespace], wsdl.definitions);
      }
      this._processNextInclude(includes, err => {
        callback(err);
      });
    });
  }

  processIncludes(callback) {
    const { schemas } = this.definitions;
    let includes = [];

    for (const ns in schemas) {
      const schema = schemas[ns];
      includes = includes.concat(schema.includes || []);
    }

    this._processNextInclude(includes, callback);
  }

  describeServices() {
    const services = {};
    for (const name in this.services) {
      const service = this.services[name];
      services[name] = service.description(this.definitions);
    }
    return services;
  }

  toXML() {
    return this.xml || '';
  }

  xmlToObject(xml, callback) {
    const parser = typeof callback === 'function' ? {} : sax.parser(true);
    let objectName = null;
    const root = {};
    const schema = {
      Envelope: {
        Header: {
          Security: {
            UsernameToken: {
              Username: 'string',
              Password: 'string'
            }
          }
        },
        Body: {
          Fault: {
            faultcode: 'string',
            faultstring: 'string',
            detail: 'string'
          }
        }
      }
    };
    const stack = [{ name: null, object: root, schema }];
    const xmlns = {};

    const refs = {};
    let id; // {id:{hrefs:[],obj:}, ...}

    parser.onopentag = node => {
      const nsName = node.name;
      const attrs  = node.attributes;

      let { name } = splitQName(nsName);
      let attributeName;
      const top = stack[stack.length - 1];
      let topSchema = top.schema;
      const elementAttributes = {};
      let hasNonXmlnsAttribute = false;
      let hasNilAttribute = false;
      const obj = {};
      const originalName = name;

      if (!objectName && top.name === 'Body' && name !== 'Fault') {
        let message = this.definitions.messages[name];
        // Support RPC/literal messages where response body contains one element named
        // After the operation + 'Response'. See http://www.w3.org/TR/wsdl#_names
        if (!message) {
          try {
            // Determine if this is request or response
            let isInput = false;
            if ((/Response$/).test(name)) {
              name = name.replace(/Response$/, '');
            } else if ((/Request$/).test(name)) {
              isInput = true;
              name = name.replace(/Request$/, '');
            } else if ((/Solicit$/).test(name)) {
              isInput = true;
              name = name.replace(/Solicit$/, '');
            }
            // Look up the appropriate message as given in the portType's operations
            const { portTypes } = this.definitions;
            const portTypeNames = Object.keys(portTypes);
            // Currently this supports only one portType definition.
            const portType = portTypes[portTypeNames[0]];
            if (isInput) {
              name = portType.methods[name].input.$name;
            } else {
              name = portType.methods[name].output.$name;
            }
            message = this.definitions.messages[name];
            // 'cache' this alias to speed future lookups
            this.definitions.messages[originalName] = this.definitions.messages[name];
          } catch (err) {
            if (this.options.returnFault) {
              parser.onerror(err);
            }
          }
        }

        topSchema = message.description(this.definitions);
        objectName = originalName;
      }

      if (attrs.href) {
        id = attrs.href.substr(1);
        if (!refs[id]) {
          refs[id] = { hrefs: [], obj: null };
        }
        refs[id].hrefs.push({ par: top.object, key: name, obj });
      }
      // eslint-disable-next-line
      if (id = attrs.id) {
        if (!refs[id]) {
          refs[id] = {
            hrefs: [],
            obj: null
          };
        }
      }

      // Handle element attributes
      for (attributeName in attrs) {
        if (/^xmlns:|^xmlns$/.test(attributeName)) {
          xmlns[splitQName(attributeName).name] = attrs[attributeName];
          continue;
        }
        hasNonXmlnsAttribute = true;
        elementAttributes[attributeName] = attrs[attributeName];
      }

      for (attributeName in elementAttributes) {
        const res = splitQName(attributeName);
        if (
          res.name === 'nil' &&
          xmlns[res.prefix] === 'http://www.w3.org/2001/XMLSchema-instance' &&
          elementAttributes[attributeName] &&
          (elementAttributes[attributeName].toLowerCase() === 'true' || elementAttributes[attributeName] === '1')
        ) {
          hasNilAttribute = true;
          break;
        }
      }

      if (hasNonXmlnsAttribute) {
        obj[this.options.attributesKey] = elementAttributes;
      }

      // Pick up the schema for the type specified in element's xsi:type attribute.
      let xsiTypeSchema;
      const xsiType = elementAttributes['xsi:type'];
      if (xsiType) {
        const type = splitQName(xsiType);
        let typeURI;
        if (type.prefix === TNS_PREFIX) {
          // In case of xsi:type = "MyType"
          typeURI = xmlns[type.prefix] || xmlns.xmlns;
        } else {
          typeURI = xmlns[type.prefix];
        }
        const typeDef = this.findSchemaObject(typeURI, type.name);
        if (typeDef) {
          xsiTypeSchema = typeDef.description(this.definitions);
        }
      }

      if (topSchema && topSchema[`${name}[]`]) {
        name = `${name}[]`;
      }
      stack.push({ name: originalName,
        object: obj,
        schema: (xsiTypeSchema || (topSchema && topSchema[name])),
        id: attrs.id,
        nil: hasNilAttribute
      });
    };

    parser.onclosetag = nsName => {
      const cur = stack.pop();
      let obj = cur.object;
      const top = stack[stack.length - 1];
      const topObject = top.object;
      const topSchema = top.schema;
      const { name } = splitQName(nsName);

      if (typeof cur.schema === 'string' && (cur.schema === 'string' || cur.schema.split(':')[1] === 'string')) {
        if (typeof obj === 'object' &&  Object.keys(obj).length === 0) {obj = cur.object = '';}
      }

      if (cur.nil === true) {
        if (this.options.handleNilAsNull) {
          obj = null;
        } else {
          return;
        }
      }

      if (_.isPlainObject(obj) && !Object.keys(obj).length) {
        obj = null;
      }

      if (topSchema && topSchema[`${name}[]`]) {
        if (!topObject[name]) {
          topObject[name] = [];
        }
        topObject[name].push(obj);
      } else if (name in topObject) {
        if (!Array.isArray(topObject[name])) {
          topObject[name] = [topObject[name]];
        }
        topObject[name].push(obj);
      } else {
        topObject[name] = obj;
      }

      if (cur.id) {
        refs[cur.id].obj = obj;
      }
    };

    parser.oncdata = text => {
      const originalText = text;
      text = trim(text);
      if (!text.length) {
        return;
      }

      if (/<\?xml[\s\S]+\?>/.test(text)) {
        const top = stack[stack.length - 1];
        const value = this.xmlToObject(text);
        if (top.object[this.options.attributesKey]) {
          top.object[this.options.valueKey] = value;
        } else {
          top.object = value;
        }
      } else {
        parser.ontext(originalText);
      }
    };

    parser.onerror = err => {
      parser.resume();
      throw {
        Fault: {
          faultcode: 500,
          faultstring: 'Invalid XML',
          detail: new Error(err).message,
          statusCode: 500
        }
      };
    };

    parser.ontext = text => {
      const originalText = text;
      text = trim(text);
      if (!text.length) {
        return;
      }

      const top = stack[stack.length - 1];
      const { name } = splitQName(top.schema);
      let value;
      if (this.options && this.options.customDeserializer && this.options.customDeserializer[name]) {
        value = this.options.customDeserializer[name](text, top);
      } else {
        if (name === 'int' || name === 'integer') {
          value = parseInt(text, 10);
        } else if (name === 'bool' || name === 'boolean') {
          value = text.toLowerCase() === 'true' || text === '1';
        } else if (name === 'dateTime' || name === 'date') {
          value = new Date(text);
        } else {
          if (this.options.preserveWhitespace) {
            text = originalText;
          }
          // handle string or other types
          if (typeof top.object !== 'string') {
            value = text;
          } else {
            value = top.object + text;
          }
        }
      }

      if (top.object[this.options.attributesKey]) {
        top.object[this.options.valueKey] = value;
      } else {
        top.object = value;
      }
    };

    if (typeof callback === 'function') {
      // We be streaming
      const saxStream = sax.createStream(true);
      saxStream.on('opentag', parser.onopentag);
      saxStream.on('closetag', parser.onclosetag);
      saxStream.on('cdata', parser.oncdata);
      saxStream.on('text', parser.ontext);
      xml.pipe(saxStream)
        .on('error', err => {
          callback(err);
        })
        .on('end', () => {
          let req;
          try {
            req = finish();
          } catch (e) {
            return callback(e);
          }
          callback(null, req);
        });
      return;
    }
    parser.write(xml).close();

    return finish();

    function finish() {
      // MultiRef support: merge objects instead of replacing
      for (const n in refs) {
        const ref = refs[n];
        for (let i = 0; i < ref.hrefs.length; i++) {
          Object.assign(ref.hrefs[i].obj, ref.obj);
        }
      }

      if (root.Envelope) {
        const body = root.Envelope.Body;
        if (body && body.Fault) {
          let code = body.Fault.faultcode && body.Fault.faultcode.$value;
          let string = body.Fault.faultstring && body.Fault.faultstring.$value;
          let detail = body.Fault.detail && body.Fault.detail.$value;

          code = code || body.Fault.faultcode;
          string = string || body.Fault.faultstring;
          detail = detail || body.Fault.detail;

          const error = new Error(`${code}: ${string}${detail ? `: ${detail}` : ''}`);

          error.root = root;
          throw error;
        }
        return root.Envelope;
      }
      return root;
    }
  }

  /**
   * Look up a XSD type or element by namespace URI and name
   * @param {String} nsURI Namespace URI
   * @param {String} qname Local or qualified name
   * @returns {*} The XSD type/element definition
   */
  findSchemaObject(nsURI, qname) {
    if (!nsURI || !qname) {
      return null;
    }

    let def = null;

    if (this.definitions.schemas) {
      const schema = this.definitions.schemas[nsURI];
      if (schema) {
        if (qname.indexOf(':') !== -1) {
          qname = qname.substring(qname.indexOf(':') + 1, qname.length);
        }

        // If the client passed an input element which has a `$lookupType` property instead of `$type`
        // The `def` is found in `schema.elements`.
        def = schema.complexTypes[qname] || schema.types[qname] || schema.elements[qname];
      }
    }

    return def;
  }

  /**
   * Create document style xml string from the parameters
   * @param {String} name
   * @param {*} params
   * @param {String} nsPrefix
   * @param {String} nsURI
   * @param {String} type
   */
  objectToDocumentXML(name, params, nsPrefix, nsURI, type) {
    // If user supplies XML already, just use that.  XML Declaration should not be present.
    if (params && params._xml) {
      return params._xml;
    }
    const args = {};
    args[name] = params;
    const parameterTypeObj = type ? this.findSchemaObject(nsURI, type) : null;
    return this.objectToXML(args, null, nsPrefix, nsURI, true, null, parameterTypeObj);
  }

  /**
   * Create RPC style xml string from the parameters
   * @param {String} name
   * @param {*} params
   * @param {String} nsPrefix
   * @param {String} nsURI
   * @returns {string}
   */
  objectToRpcXML(name, params, nsPrefix, nsURI, isParts) {
    const parts = [];
    const defs = this.definitions;
    const nsAttrName = '_xmlns';

    nsPrefix = nsPrefix || findPrefix(defs.xmlns, nsURI);

    nsURI = nsURI || defs.xmlns[nsPrefix];
    nsPrefix = nsPrefix === TNS_PREFIX ? '' : (`${nsPrefix}:`);

    parts.push(['<', nsPrefix, name, '>'].join(''));

    for (const key in params) {
      if (!params.hasOwnProperty(key)) {
        continue;
      }
      if (key !== nsAttrName) {
        const value = params[key];
        const prefixedKey = (isParts ? '' : nsPrefix) + key;
        const attributes = [];
        if (typeof value === 'object' && value.hasOwnProperty(this.options.attributesKey)) {
          const attrs = value[this.options.attributesKey];
          for (const n in attrs) {
            attributes.push(` ${n}=` + `"${attrs[n]}"`);
          }
        }
        parts.push(['<', prefixedKey ].concat(attributes).concat('>').join(''));
        parts.push((typeof value === 'object') ? this.objectToXML(value, key, nsPrefix, nsURI) : xmlEscape(value));
        parts.push(['</', prefixedKey, '>'].join(''));
      }
    }
    parts.push(['</', nsPrefix, name, '>'].join(''));
    return parts.join('');
  }

  isIgnoredNameSpace(ns) {
    return this.options.ignoredNamespaces.indexOf(ns) > -1;
  }

  filterOutIgnoredNameSpace(ns) {
    const namespace = noColonNameSpace(ns);
    return this.isIgnoredNameSpace(namespace) ? '' : namespace;
  }

  /**
   * Convert an object to XML.  This is a recursive method as it calls itself.
   *
   * @param {Object} obj the object to convert.
   * @param {String} name the name of the element (if the object being traversed is
   * an element).
   * @param {String} nsPrefix the namespace prefix of the object I.E. xsd.
   * @param {String} nsURI the full namespace of the object I.E. http://w3.org/schema.
   * @param {Boolean} isFirst whether or not this is the first item being traversed.
   * @param {?} xmlnsAttr
   * @param {?} parameterTypeObject
   * @param {NamespaceContext} nsContext Namespace context
   */
  objectToXML(obj, name, nsPrefix, nsURI, isFirst, xmlnsAttr, schemaObject, nsContext) {
    const schema = this.definitions.schemas[nsURI];

    let parentNsPrefix = nsPrefix ? nsPrefix.parent : undefined;
    if (typeof parentNsPrefix !== 'undefined') {
      // we got the parentNsPrefix for our array. setting the namespace-variable back to the current namespace string
      nsPrefix = nsPrefix.current;
    }

    parentNsPrefix = noColonNameSpace(parentNsPrefix);
    if (this.isIgnoredNameSpace(parentNsPrefix)) {
      parentNsPrefix = '';
    }

    const soapHeader = !schema;
    const qualified = schema && schema.$elementFormDefault === 'qualified';
    const parts = [];
    const prefixNamespace = (nsPrefix || qualified) && nsPrefix !== TNS_PREFIX;

    let xmlnsAttrib = '';
    if (nsURI && isFirst) {
      if (this.options.overrideRootElement && this.options.overrideRootElement.xmlnsAttributes) {
        this.options.overrideRootElement.xmlnsAttributes.forEach(attribute => {
          xmlnsAttrib += ` ${attribute.name}="${attribute.value}"`;
        });
      } else {
        if (prefixNamespace && !this.isIgnoredNameSpace(nsPrefix)) {
          // resolve the prefix namespace
          xmlnsAttrib += ` xmlns:${nsPrefix}="${nsURI}"`;
        }
        // only add default namespace if the schema elementFormDefault is qualified
        if (qualified || soapHeader) {xmlnsAttrib += ` xmlns="${nsURI}"`;}
      }
    }

    if (!nsContext) {
      nsContext = new NamespaceContext();
      nsContext.declareNamespace(nsPrefix, nsURI);
    } else {
      nsContext.pushContext();
    }

    // explicitly use xmlns attribute if available
    if (xmlnsAttr && !(this.options.overrideRootElement && this.options.overrideRootElement.xmlnsAttributes)) {
      xmlnsAttrib = xmlnsAttr;
    }

    let ns = '';

    if (this.options.overrideRootElement && isFirst) {
      ns = this.options.overrideRootElement.namespace;
    } else if (prefixNamespace && (qualified || isFirst || soapHeader) && !this.isIgnoredNameSpace(nsPrefix)) {
      ns = nsPrefix;
    }

    let i;
    let n;
    // start building out XML string.
    if (Array.isArray(obj)) {
      for (i = 0, n = obj.length; i < n; i++) {
        const item = obj[i];
        const arrayAttr = this.processAttributes(item, nsContext);
        const correctOuterNsPrefix = parentNsPrefix || ns; // using the parent namespace prefix if given

        const body = this.objectToXML(item, name, nsPrefix, nsURI, false, null, schemaObject, nsContext);

        const openingTagParts = ['<', appendColon(correctOuterNsPrefix), name, arrayAttr, xmlnsAttrib];

        if (body === '' && this.options.useEmptyTag) {
          // Use empty (self-closing) tags if no contents
          openingTagParts.push(' />');
          parts.push(openingTagParts.join(''));
        } else {
          openingTagParts.push('>');
          if (this.options.namespaceArrayElements || i === 0) {
            parts.push(openingTagParts.join(''));
          }
          parts.push(body);
          if (this.options.namespaceArrayElements || i === n - 1) {
            parts.push(['</', appendColon(correctOuterNsPrefix), name, '>'].join(''));
          }
        }
      }
    } else if (typeof obj === 'object') {
      for (name in obj) {
        if (!obj.hasOwnProperty(name)) {continue;}
        // don't process attributes as element
        if (name === this.options.attributesKey) {
          continue;
        }
        // Its the value of a xml object. Return it directly.
        if (name === this.options.xmlKey){
          nsContext.popContext();
          return obj[name];
        }
        // Its the value of an item. Return it directly.
        if (name === this.options.valueKey) {
          nsContext.popContext();
          return xmlEscape(obj[name]);
        }

        const child = obj[name];
        if (typeof child === 'undefined') {
          continue;
        }

        const attr = this.processAttributes(child, nsContext);

        let value = '';
        let nonSubNameSpace = '';
        let emptyNonSubNameSpace = false;

        const nameWithNsRegex = /^([^:]+):([^:]+)$/.exec(name);
        if (nameWithNsRegex) {
          nonSubNameSpace = `${nameWithNsRegex[1]}:`;
          [, , name] = nameWithNsRegex;
        } else if (name[0] === ':'){
          emptyNonSubNameSpace = true;
          name = name.substr(1);
        }

        if (isFirst) {
          value = this.objectToXML(child, name, nsPrefix, nsURI, false, null, schemaObject, nsContext);
        } else {

          if (this.definitions.schemas) {
            if (schema) {
              const childSchemaObject = this.findChildSchemaObject(schemaObject, name);
              // find sub namespace if not a primitive
              if (childSchemaObject &&
                ((childSchemaObject.$type && (childSchemaObject.$type.indexOf('xsd:') === -1)) ||
                childSchemaObject.$ref || childSchemaObject.$name)) {
                /* if the base name space of the children is not in the ingoredSchemaNamspaces we use it.
                This is because in some services the child nodes do not need the baseNameSpace.
                */

                let childNsPrefix = '';
                let childName = '';
                let childNsURI;
                let childXmlnsAttrib = '';

                let elementQName = childSchemaObject.$ref || childSchemaObject.$name;
                if (elementQName) {
                  elementQName = splitQName(elementQName);
                  childName = elementQName.name;
                  if (elementQName.prefix === TNS_PREFIX) {
                    // Local element
                    childNsURI = childSchemaObject.$targetNamespace;
                    childNsPrefix = nsContext.registerNamespace(childNsURI);
                    if (this.isIgnoredNameSpace(childNsPrefix)) {
                      childNsPrefix = nsPrefix;
                    }
                  } else {
                    childNsPrefix = elementQName.prefix;
                    if (this.isIgnoredNameSpace(childNsPrefix)) {
                      childNsPrefix = nsPrefix;
                    }
                    childNsURI = schema.xmlns[childNsPrefix] || this.definitions.xmlns[childNsPrefix];
                  }

                  let unqualified = false;
                  // Check qualification form for local elements
                  if (childSchemaObject.$name && childSchemaObject.targetNamespace === undefined) {
                    if (childSchemaObject.$form === 'unqualified') {
                      unqualified = true;
                    } else if (childSchemaObject.$form === 'qualified') {
                      unqualified = false;
                    } else {
                      unqualified = schema.$elementFormDefault !== 'qualified';
                    }
                  }
                  if (unqualified) {
                    childNsPrefix = '';
                  }

                  if (childNsURI && childNsPrefix) {
                    if (nsContext.declareNamespace(childNsPrefix, childNsURI)) {
                      childXmlnsAttrib = ` xmlns:${childNsPrefix}="${childNsURI}"`;
                      xmlnsAttrib += childXmlnsAttrib;
                    }
                  }
                }

                let resolvedChildSchemaObject;
                if (childSchemaObject.$type) {
                  const typeQName = splitQName(childSchemaObject.$type);
                  const typePrefix = typeQName.prefix;
                  const typeURI = schema.xmlns[typePrefix] || this.definitions.xmlns[typePrefix];
                  childNsURI = typeURI;
                  if (typeURI !== 'http://www.w3.org/2001/XMLSchema' && typePrefix !== TNS_PREFIX) {
                    // Add the prefix/namespace mapping, but not declare it
                    nsContext.addNamespace(typePrefix, typeURI);
                  }
                  resolvedChildSchemaObject =
                    this.findSchemaType(typeQName.name, typeURI) || childSchemaObject;
                } else {
                  resolvedChildSchemaObject =
                    this.findSchemaObject(childNsURI, childName) || childSchemaObject;
                }

                if (childSchemaObject.$baseNameSpace && this.options.ignoreBaseNameSpaces) {
                  childNsPrefix = nsPrefix;
                  childNsURI = nsURI;
                }

                if (this.options.ignoreBaseNameSpaces) {
                  childNsPrefix = '';
                  childNsURI = '';
                }

                ns = childNsPrefix;

                if (Array.isArray(child)) {
                  // for arrays, we need to remember the current namespace
                  childNsPrefix = {
                    current: childNsPrefix,
                    parent: ns
                  };
                } else {
                  // parent (array) already got the namespace
                  childXmlnsAttrib = null;
                }

                value = this.objectToXML(child, name, childNsPrefix, childNsURI,
                  false, childXmlnsAttrib, resolvedChildSchemaObject, nsContext);
              } else if (obj[this.options.attributesKey] && obj[this.options.attributesKey].xsi_type) {
                // if parent object has complex type defined and child not found in parent
                const completeChildParamTypeObject = this.findChildSchemaObject(
                  obj[this.options.attributesKey].xsi_type.type,
                  obj[this.options.attributesKey].xsi_type.xmlns);

                nonSubNameSpace = obj[this.options.attributesKey].xsi_type.prefix;
                nsContext.addNamespace(obj[this.options.attributesKey].xsi_type.prefix,
                  obj[this.options.attributesKey].xsi_type.xmlns);
                value = this.objectToXML(child, name, obj[this.options.attributesKey].xsi_type.prefix,
                  obj[this.options.attributesKey].xsi_type.xmlns, false, null, null, nsContext);
              } else {
                if (Array.isArray(child)) {
                  name = nonSubNameSpace + name;
                }

                value = this.objectToXML(child, name, nsPrefix, nsURI, false, null, null, nsContext);
              }
            } else {
              value = this.objectToXML(child, name, nsPrefix, nsURI, false, null, null, nsContext);
            }
          }
        }

        ns = noColonNameSpace(ns);
        if (prefixNamespace && !qualified && isFirst && !this.options.overrideRootElement) {
          ns = nsPrefix;
        } else if (this.isIgnoredNameSpace(ns)) {
          ns = '';
        }

        const useEmptyTag = !value && this.options.useEmptyTag;
        if (!Array.isArray(child)) {
          // start tag
          parts.push(['<', emptyNonSubNameSpace ? '' : appendColon(nonSubNameSpace || ns), name, attr, xmlnsAttrib,
            (child === null ? ' xsi:nil="true"' : ''),
            useEmptyTag ? ' />' : '>'
          ].join(''));
        }

        if (!useEmptyTag) {
          parts.push(value);
          if (!Array.isArray(child)) {
            // end tag
            parts.push(['</', emptyNonSubNameSpace ? '' : appendColon(nonSubNameSpace || ns), name, '>'].join(''));
          }
        }
      }
    } else if (obj !== undefined) {
      parts.push((this.options.escapeXML) ? xmlEscape(obj) : obj);
    }
    nsContext.popContext();
    return parts.join('');
  }

  processAttributes(child, nsContext) {
    let attr = '';

    if (child === null) {
      child = [];
    }

    const attrObj = child[this.options.attributesKey];
    if (attrObj && attrObj.xsi_type) {
      const xsiType = attrObj.xsi_type;

      let prefix = xsiType.prefix || xsiType.namespace;
      // Generate a new namespace for complex extension if one not provided
      if (!prefix) {
        prefix = nsContext.registerNamespace(xsiType.xmlns);
      } else {
        nsContext.declareNamespace(prefix, xsiType.xmlns);
      }
      xsiType.prefix = prefix;
    }


    if (attrObj) {
      for (const attrKey in attrObj) {
        // handle complex extension separately
        if (attrKey === 'xsi_type') {
          const attrValue = attrObj[attrKey];
          attr += ` xsi:type="${attrValue.prefix}:${attrValue.type}"`;
          attr += ` xmlns:${attrValue.prefix}="${attrValue.xmlns}"`;

          continue;
        } else {
          attr += ` ${attrKey}="${xmlEscape(attrObj[attrKey])}"`;
        }
      }
    }

    return attr;
  }

  /**
   * Look up a schema type definition
   * @param name
   * @param nsURI
   * @returns {*}
   */
  findSchemaType(name, nsURI) {
    if (!this.definitions.schemas || !name || !nsURI) {
      return null;
    }

    const schema = this.definitions.schemas[nsURI];
    if (!schema || !schema.complexTypes) {
      return null;
    }

    return schema.complexTypes[name];
  }

  findChildSchemaObject(parameterTypeObj, childName, backtrace) {
    if (!parameterTypeObj || !childName) {
      return null;
    }

    if (!backtrace) {
      backtrace = [];
    }

    if (backtrace.indexOf(parameterTypeObj) >= 0) {
      // We've recursed back to ourselves; break.
      return null;
    }
    backtrace = backtrace.concat([parameterTypeObj]);

    let found = null;
    let i = 0;
    let child;
    let ref;

    if (Array.isArray(parameterTypeObj.$lookupTypes) && parameterTypeObj.$lookupTypes.length) {
      const types = parameterTypeObj.$lookupTypes;

      for (i = 0; i < types.length; i++) {
        const typeObj = types[i];

        if (typeObj.$name === childName) {
          found = typeObj;
          break;
        }
      }
    }

    const object = parameterTypeObj;
    if (object.$name === childName && object.name === 'element') {
      return object;
    }
    if (object.$ref) {
      ref = splitQName(object.$ref);
      if (ref.name === childName) {
        return object;
      }
    }

    let childNsURI;

    // want to avoid unecessary recursion to improve performance
    if (object.$type && backtrace.length === 1) {
      const typeInfo = splitQName(object.$type);
      if (typeInfo.prefix === TNS_PREFIX) {
        childNsURI = parameterTypeObj.$targetNamespace;
      } else {
        childNsURI = this.definitions.xmlns[typeInfo.prefix];
      }
      const typeDef = this.findSchemaType(typeInfo.name, childNsURI);
      if (typeDef) {
        return this.findChildSchemaObject(typeDef, childName, backtrace);
      }
    }

    if (object.children) {
      for (i = 0, child; child = object.children[i]; i++) {
        found = this.findChildSchemaObject(child, childName, backtrace);
        if (found) {
          break;
        }

        if (child.$base) {
          const baseQName = splitQName(child.$base);
          const childNameSpace = baseQName.prefix === TNS_PREFIX ? '' : baseQName.prefix;
          childNsURI = child.xmlns[baseQName.prefix] || this.definitions.xmlns[baseQName.prefix];

          const foundBase = this.findSchemaType(baseQName.name, childNsURI);

          if (foundBase) {
            found = this.findChildSchemaObject(foundBase, childName, backtrace);

            if (found) {
              found.$baseNameSpace = childNameSpace;
              found.$type = `${childNameSpace}:${childName}`;
              break;
            }
          }
        }
      }

    }

    if (!found && object.$name === childName) {
      return object;
    }

    return found;
  }

  _parse(xml) {
    const parser = sax.parser(true);
    const stack = [];
    let root = null;
    let types = null;
    let schema = null;
    const { options } = this;

    parser.onopentag = node => {
      const nsName = node.name;
      const attrs = node.attributes;

      const top = stack[stack.length - 1];
      let name;
      if (top) {
        try {
          top.startElement(stack, nsName, attrs, options);
        } catch (e) {
          if (options.strict) {
            throw e;
          } else {
            stack.push(new Element(nsName, attrs, options));
          }
        }
      } else {
        ({ name } = splitQName(nsName));
        if (name === 'definitions') {
          root = new DefinitionsElement(nsName, attrs, options);
          stack.push(root);
        } else if (name === 'schema') {
          // Shim a structure in here to allow the proper objects to be created when merging back.
          root = new DefinitionsElement('definitions', {}, {});
          types = new TypesElement('types', {}, {});
          schema = new SchemaElement(nsName, attrs, options);
          types.addChild(schema);
          root.addChild(types);
          stack.push(schema);
        } else {
          throw new Error('Unexpected root element of WSDL or include');
        }
      }
    };

    parser.onclosetag = name => {
      const top = stack[stack.length - 1];
      assert(top, `Unmatched close tag: ${name}`);

      top.endElement(stack, name);
    };

    parser.write(xml).close();

    return root;
  }

  _fromXML(xml) {
    this.definitions = this._parse(xml);
    this.definitions.descriptions = {
      types: {}
    };
    this.xml = xml;
  }

  _fromServices() {

  }

  _xmlnsMap() {
    const { xmlns } = this.definitions;
    let str = '';
    for (const alias in xmlns) {
      if (alias === '' || alias === TNS_PREFIX) {
        continue;
      }
      const ns = xmlns[alias];
      switch (ns) {
      case 'http://xml.apache.org/xml-soap': // apachesoap
      case 'http://schemas.xmlsoap.org/wsdl/': // wsdl
      case 'http://schemas.xmlsoap.org/wsdl/soap/': // wsdlsoap
      case 'http://schemas.xmlsoap.org/wsdl/soap12/': // wsdlsoap12
      case 'http://schemas.xmlsoap.org/soap/encoding/': // soapenc
      case 'http://www.w3.org/2001/XMLSchema': // xsd
        continue;
      default:
        // noop
      }
      if (ns.startsWith('http://schemas.xmlsoap.org/')) {
        continue;
      }
      if (ns.startsWith('http://www.w3.org/')) {
        continue;
      }
      if (ns.startsWith('http://xml.apache.org/')) {
        continue;
      }
      str += ` xmlns:${alias}="${ns}"`;
    }
    return str;
  }
}

WSDL.prototype.ignoredNamespaces = ['tns', 'targetNamespace', 'typedNamespace'];

WSDL.prototype.ignoreBaseNameSpaces = false;

WSDL.prototype.valueKey = '$value';
WSDL.prototype.xmlKey = '$xml';

function openWsdl(uri, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // initialize cache when calling openWsdl directly
  const WSDL_CACHE = options.WSDL_CACHE || {};
  const requestHeaders = options.wsdl_headers;
  const requestOptions = options.wsdl_options;

  let wsdl;
  if (/^https?:/.test(uri)) {
    debug('Reading url: %s', uri);
    const httpClient = options.httpClient || new HttpClient(options);
    httpClient.request(uri, null /* options */, (err, response, definition) => {
      if (err) {
        callback(err);
        return;
      }
      if (response && response.statusCode === 200) {
        wsdl = new WSDL(definition, uri, options);
        WSDL_CACHE[uri] = wsdl;
        wsdl.WSDL_CACHE = WSDL_CACHE;
        wsdl.onReady(callback);
        return;
      }
      callback(new Error(`Invalid WSDL URL: ${uri}\n\n\r Code: ${response.statusCode}\n\n\r Response Body: ${response.body}`));
    }, requestHeaders, requestOptions);
  } else {
    debug('Reading file: %s', uri);
    fs.readFile(uri, 'utf8', (err, definition) => {
      if (err) {
        callback(err);
        return;
      }
      wsdl = new WSDL(definition, uri, options);
      WSDL_CACHE[uri] = wsdl;
      wsdl.WSDL_CACHE = WSDL_CACHE;
      wsdl.onReady(callback);
    });
  }

  return wsdl;
}

/*
 * Have another function to load previous WSDLs as we
 * don't want this to be invoked externally (expect for tests)
 * This will attempt to fix circular dependencies with XSD files,
 * Given
 * - file.wsdl
 *   - xs:import namespace="A" schemaLocation: A.xsd
 * - A.xsd
 *   - xs:import namespace="B" schemaLocation: B.xsd
 * - B.xsd
 *   - xs:import namespace="A" schemaLocation: A.xsd
 * file.wsdl will start loading, import A, then A will import B, which will then import A
 * Because A has already started to load previously it will be returned right away and
 * have an internal circular reference
 * B would then complete loading, then A, then file.wsdl
 * By the time file A starts processing its includes its definitions will be already loaded,
 * this is the only thing that B will depend on when "opening" A
 */
function openWsdlRecursive(uri, options, callback) {
  let fromCache;

  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  const { WSDL_CACHE } = options;

  if (fromCache = WSDL_CACHE[uri]) {
    return callback.call(fromCache, null, fromCache);
  }

  return openWsdl(uri, options, callback);
}

exports.openWsdl = openWsdl;
exports.WSDL = WSDL;
