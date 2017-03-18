'use strict';

const assert    = require('ember-cli/tests/helpers/assert');
//var chai      = require('chai');
//var lodash    = require('lodash');
const Client = require('../../../lib/ssh-client');


describe('ssh-client', function() {
  let options = {
    username: 'aaron',
    privateKeyPath: null,
    host: "mydomain.com",
    agent: null,
    port: 22
  };

  describe('#init', function() {

    it('sets options', function() {
      // var options = lodash.omit(options, 'username');
      let client = new Client(options);

      assert.equal(client.options, options);
    });

  });
});
