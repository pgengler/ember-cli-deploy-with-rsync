/* eslint-env node, mocha */
'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
const assert = chai.assert;
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
