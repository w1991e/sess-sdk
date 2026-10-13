'use strict';

// CommonJS applications use asynchronous import. No network runs on import.
module.exports.createSess = async function createSess(apiKey, options = {}) {
  const { Sess } = await import('@sess/sdk');
  return new Sess({ ...options, apiKey });
};
