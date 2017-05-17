/* eslint-env node, mocha */
'use strict';

const fs   = require('node-fs');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const RSVP = require('rsvp');

chai.use(chaiAsPromised);
const assert = chai.assert;

class MockSSHClient {
  constructor(options) {
    this._uploadedFiles = { };
    this.options = options;
  }

  connect() {
    this._connected = true;
    return RSVP.resolve();
  }

  readFile(path) {
    return new RSVP.Promise((resolve, reject) => {
      if (this._readFileError) {
        reject(this._readFileError);
      } else {
        let file = this._uploadedFiles[path];
        resolve(file);
      }
    });
  }

  upload(path, data) {
    return new RSVP.Promise((resolve) => {
      this._uploadedFiles[path] = data.toString();
      resolve();
    });
  }

  putFile(src, dest) {
    return new RSVP.Promise((resolve) => {
      let file = fs.readFileSync(src, 'utc8');
      this._uploadedFiles[dest] = file.toString();
      resolve();
    });
  }

  exec(command) {
    return new RSVP.Promise((resolve) => {
      this._command = command;
      resolve();
    });
  }
}

describe('the deploy plugin object', function() {
  let plugin;
  let configure;
  let context;

  beforeEach(function() {
    const subject = require('../../index');

    plugin = subject.createDeployPlugin({
      name: 'with-rsync'
    });

    context = {
      ui: {write: function() {}, writeLine: function() {}},
      config: {
        'with-rsync': {
          username: 'deployer',
          password: 'mypass',
          root: '/usr/local/www/my-app',
          distDir: 'tests/fixtures/dist',
          revisionMeta(context, pluginHelper) {
            let revisionKey = pluginHelper.readConfig('revisionKey');

            return {
              revision: revisionKey,
            };
          },
        }
      },
      revisionData: {
        revisionKey: '89b1d82820a24bfb075c5b43b36f454b'
      }
    };

    plugin._sshClient = MockSSHClient;

    plugin.beforeHook(context);
    configure = plugin.configure(context);
  });

  it('has a name', function() {
    assert.equal('with-rsync', plugin.name);
  });

  it('implements the correct hooks', function() {
    assert.equal(typeof plugin.configure, 'function');
    assert.equal(typeof plugin.fetchRevisions, 'function');
  });

  describe('configure hook', function() {
    it('opens up a ssh connection.', function() {
      return assert.isFulfilled(configure)
        .then(function() {
          let client = plugin._client;

          assert.equal(client._connected, true);
        });
    });

    it('instantiates a sshClient and assigns it to the `_client` property.', function() {
      return assert.isFulfilled(configure)
        .then(function() {
          let client = plugin._client;

          assert.equal(client.options.username, 'deployer');
          assert.equal(client.options.password, 'mypass');
        });
    });
  });

  describe('fetchRevisions hook', function() {
    it('assigns context.revisions property.', function() {
      let revisions = [ { revision: '4564564545646' } ];
      let client = plugin._client;
      let files = {};

      files['/usr/local/www/my-app/revisions.json'] = JSON.stringify(revisions);

      client._uploadedFiles = files;

      let fetching = plugin.fetchRevisions(context);

      return assert.isFulfilled(fetching).then(function() {
        assert.deepEqual(context.revisions, revisions);
      });
    });

    it('assigns context.revisions property to empty array if revision file not found.', function() {
      let client = plugin._client;

      client._readFileError = new Error('No such file');
      client._readFile = null;

      let fetching = plugin.fetchRevisions(context);

      return assert.isFulfilled(fetching).then(function() {
        assert.deepEqual(context.revisions, [ ]);
      });
    });
  });

  describe('activate hook', function() {
    it('creates a symbolic link to active version', function() {
      let activating = plugin.activate(context);
      let client = plugin._client;

      return assert.isFulfilled(activating).then(function() {
        assert.equal(client._command, 'ln -fsn /usr/local/www/my-app/revisions/89b1d82820a24bfb075c5b43b36f454b/ /usr/local/www/my-app/active');
      });
    });

    it('copies revision to activationDestination if activationStrategy is copy', function() {
      context.config['with-rsync'].activationStrategy = 'copy';
      plugin.configure(context);

      let activating = plugin.activate(context);
      let client = plugin._client;

      return assert.isFulfilled(activating).then(function() {
        assert.equal(client._command, 'cp -TR /usr/local/www/my-app/revisions/89b1d82820a24bfb075c5b43b36f454b/ /usr/local/www/my-app/active');
      });
    });

    it('returns revisionData', function() {
      let activating = plugin.activate(context);
      let expected = {
        revisionData: {
          activatedRevisionKey: '89b1d82820a24bfb075c5b43b36f454b'
        }
      };

      return assert.isFulfilled(activating).then(function(revisionData) {
        assert.deepEqual(expected, revisionData);
      });
    });

  });

  describe('upload hook', function() {
    it('updates revisionManifest', function() {
      let manifestPath = '/usr/local/www/my-app/revisions.json';
      let revisions = [ { revision: '4564564545646' } ];
      let client = plugin._client;
      let files = { };
      files[manifestPath] = JSON.stringify(revisions);

      client._uploadedFiles = files;

      let uploading = plugin.upload(context);

      return assert.isFulfilled(uploading).then(function() {
        let manifest = client._uploadedFiles[manifestPath];
        revisions.unshift({ revision: '89b1d82820a24bfb075c5b43b36f454b' });
        assert.equal(JSON.stringify(revisions), manifest);
      });
    });
  });

});
