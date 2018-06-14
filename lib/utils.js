'use strict';

const { createHash } = require('crypto');
exports.passwordDigest = function passwordDigest(nonce, created, password) {
  const pwHash = createHash('sha1');
  // Node v4 buffer compat
  // eslint-disable-next-line
  const rawNonce = new Buffer(nonce || '', 'base64').toString('binary');
  pwHash.update(rawNonce + created + password);
  return pwHash.digest('base64');
};

// Prefix for targetNamespace
const TNS_PREFIX = '__tns__';

exports.TNS_PREFIX = TNS_PREFIX;

/**
 * Find a key from an object based on the value
 * @param {Object} Namespace prefix/uri mapping
 * @param {*} nsURI value
 * @returns {String} The matching key
 */
exports.findPrefix = function findPrefix(xmlnsMapping, nsURI) {
  for (const name in xmlnsMapping) {
    if (name === TNS_PREFIX) {
      continue;
    }
    if (xmlnsMapping[name] === nsURI) {
      return name;
    }
  }
  return undefined;
};

/**
 * Returns an ISO date without milliseconds
 * @param {Date} date
 * @returns {String}
 */
exports.getDate = function getDate(date) {
  return date.toISOString().replace(/\.\d+Z/, 'Z');
};
