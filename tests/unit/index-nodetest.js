/* eslint-env node, mocha */
'use strict';

const fs   = require('node-fs');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

chai.use(chaiAsPromised);
const assert = chai.assert;

class MockSSHClient {
  constructor(options) {
    this._uploadedFiles = { };
    this.options = options;
  }

  connect() {
    this._connected = true;
    return Promise.resolve();
  }

  readFile(path) {
    if (this._readFileError) {
      return Promise.reject(this._readFileError);
    } else {
      let file = this._uploadedFiles[path];
      if (file) {
        return Promise.resolve(file);
      } else {
        return Promise.reject(new Error('No such file'));
      }
    }
  }

  upload(path, data) {
    this._uploadedFiles[path] = data.toString();
    return Promise.resolve();
  }

  putFile(src, dest) {
    let file = fs.readFileSync(src, 'utc8');
    this._uploadedFiles[dest] = file.toString();
    return Promise.resolve();
  }

  exec(command) {
    this._command = command;
    return Promise.resolve();
  }
}

class MockRsyncClient {
  constructor() {
    this._destinationArgs = null;
    this._flagsArgs = null;
    this._shellArgs = null;
    this._sourceArgs = null;
  }

  destination() {
    this._destinationArgs = arguments;
    return this;
  }

  execute(callback) {
    if (this._executeShouldFail) {
      callback(new Error("failed"));
    }
    callback();
  }

  flags() {
    this._flagsArgs = arguments;
    return this;
  }

  shell() {
    this._shellArgs = arguments;
    return this;
  }

  source() {
    this._sourceArgs = arguments;
    return this;
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
    plugin._rsyncClientClass = MockRsyncClient;

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
      // client._readFileError = new Error('No such file');

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
      plugin._uploadApplicationFiles = () => Promise.resolve();

      let uploading = plugin.upload(context);

      return assert.isFulfilled(uploading).then(function() {
        let manifest = client._uploadedFiles[manifestPath];
        revisions.unshift({ revision: '89b1d82820a24bfb075c5b43b36f454b' });
        assert.equal(JSON.stringify(revisions), manifest);
      });
    });

    it('returns a rejected promise when rsync fails', function() {
      plugin._rsync = () => Promise.reject();
      let uploading = plugin.upload();

      return assert.isRejected(uploading);
    });
  });

  describe('_rsync', function() {
    it('returns a resolved promise when rsync succeeds', function() {
      let promise = plugin._rsync();

      return assert.isFulfilled(promise);
    });

    it('returns a rejected promise when rsync fails', function() {
      plugin._rsyncClient._executeShouldFail = true;
      let promise = plugin._rsync();

      return assert.isRejected(promise);
    });
  });
});
