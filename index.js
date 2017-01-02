/* jshint node: true */
'use strict';

var Promise          = require('ember-cli/lib/ext/promise');
var DeployPluginBase = require('ember-cli-deploy-plugin');
var path             = require('path');
var os               = require('os');
var username         = require('username');
var lodash           = require('lodash');
var Rsync            = require('rsync');
var sshClient        = require('./lib/ssh-client');

module.exports = {
  name: 'ember-cli-deploy-with-rsync',

  createDeployPlugin: function(options) {
    var DeployPlugin = DeployPluginBase.extend({
      name: options.name,
      _sshClient: sshClient,
      _client: null,
      defaultConfig: {
        distDir: function(context) {
          return context.distDir;
        },
        host: '',
        username: '',
        password: null,
        privateKeyPath: '~/.ssh/id_rsa',
        rsyncFlags: 'rtvu',
        agent: null,
        port: 22,
        directory: 'tmp/deploy-dist/.',

        root: function(context) {
          return path.posix.join('/usr/local/www', context.project.name());
        },

        activationDestination: function(/*context*/) {
          var root = this.readConfig('root');

          return path.posix.join(root, 'active');
        },

        activationStrategy: 'symlink',

        uploadDestination: function(/*context*/){
          var root = this.readConfig('root');

          return path.posix.join(root, 'revisions');
        },

        revisionManifest: function(/*context*/) {
          var root = this.readConfig('root');

          return path.posix.join(root, 'revisions.json');
        },

        revisionKey: function(context) {
          return (context.commandOptions && context.commandOptions.revision) || (context.revisionData && context.revisionData.revisionKey);
        },

        revisionMeta: function(/*context*/) {
          var revisionKey = this.readConfig('revisionKey');
          var who = username.sync() + '@' + os.hostname();

          return {
            revision: revisionKey,
            deployer: who,
            timestamp: new Date().getTime(),
          };
        },
      },

      configure: function(context) {
        this._super.configure.call(this, context);

        var options = {
          host: this.readConfig('host'),
          username: this.readConfig('username'),
          password: this.readConfig('password'),
          port: this.readConfig('port'),
          privateKeyPath: this.readConfig('privateKeyPath'),
          passphrase: this.readConfig('passphrase'),
          agent: this.readConfig('agent')
        };

        this._client = new this._sshClient(options);
        return this._client.connect(this);
      },

      activate: function(/*context*/) {
        var _this = this;
        var client = this._client;
        var revisionKey = this.readConfig('revisionKey');
        var activationDestination = this.readConfig('activationDestination');
        var uploadDestination = path.posix.join(this.readConfig('uploadDestination'), '/');
        var activeRevisionPath =  path.posix.join(uploadDestination, revisionKey, '/');
        var activationStrategy = this.readConfig('activationStrategy');
        var revisionData = {
          revisionData: {
            activatedRevisionKey: revisionKey
          }
        };
        var linkCmd;

        this.log('Activating revision ' + revisionKey);

        if (activationStrategy === 'copy') {
          linkCmd = 'cp -TR ' + activeRevisionPath + ' ' + activationDestination;
        } else {
          linkCmd = 'ln -fsn ' + activeRevisionPath + ' ' + activationDestination;
        }


        return new Promise(function(resolve, reject) {
          client.exec(linkCmd).then(
            function() {
              _this._activateRevisionManifest().then(
                resolve(revisionData),
                reject
              );
            },
            reject
          );
        });
      },


      fetchRevisions: function(context) {
        var _this = this;
        this.log('Fetching Revisions');

        return this._fetchRevisionManifest().then(
          function(manifest) {
            context.revisions = manifest;
          },
          function(error) {
            _this.log(error, { color: 'red' });
          }
        );
      },

      upload: function(/*context*/) {
        var _this = this;

        return this._updateRevisionManifest().then(
          function() {
            _this.log('Successfully uploaded updated manifest.', { verbose: true });

            return _this._uploadApplicationFiles();
          },
          function(error) {
            _this.log(error, { color: 'red' });
          }
        );
      },

      teardown: function(/*context*/) {
        return this._client.disconnect();
      },

      _uploadApplicationFiles: function(/*context*/) {
        var client = this._client;
        var revisionKey = this.readConfig('revisionKey');
        var uploadDestination = this.readConfig('uploadDestination');
        var destination = path.posix.join(uploadDestination, revisionKey);
        var generatedPath = this.readConfig('username') + '@' + this.readConfig('host') + ':' + destination;

        this.log('Uploading `applicationFiles` to ' + destination);

        client.exec('mkdir -p ' + destination);
        this._rsync(generatedPath);
      },

      _activateRevisionManifest: function(/*context*/) {
        var _this = this;
        var client = this._client;
        var revisionKey = this.readConfig('revisionKey');
        var fetching = this._fetchRevisionManifest();
        var manifestPath = this.readConfig('revisionManifest');

        return new Promise(function(resolve, reject) {
          fetching.then(
            function(manifest) {
              manifest = lodash.map(manifest, function(rev) {
                if (rev.revision = revisionKey) {
                  rev.active = true;
                } else {
                  delete rev['active'];
                }
                return rev;
              });

              var data = new Buffer(JSON.stringify(manifest), 'utf-8');

              client.upload(manifestPath, data, _this).then(resolve, reject);
            },
            function(error) {
              _this.log(error, { color: 'red' });
              reject(error);
            }
          );
        });
      },

      _updateRevisionManifest: function() {
        var revisionKey  = this.readConfig('revisionKey');
        var revisionMeta = this.readConfig('revisionMeta');
        var manifestPath = this.readConfig('revisionManifest');
        var client       = this._client;
        var _this        = this;

        this.log('Updating `revisionManifest` ' + manifestPath, { verbose: true });

        return new Promise(function(resolve, reject) {
          _this._fetchRevisionManifest().then(
            function(manifest) {
              var existing = manifest.some(function(rev) {
                return rev.revision === revisionKey;
              });

              if (existing) {
                _this.log('Revision ' + revisionKey + ' already added to `revisionManifest` moving on.', { verbose: true });
                resolve();
                return;
              }

              _this.log('Adding ' + JSON.stringify(revisionMeta), { verbose: true });

              manifest.unshift(revisionMeta);

              var data = new Buffer(JSON.stringify(manifest), 'utf-8');

              client.upload(manifestPath, data).then(resolve, reject);
            },
            function(error) {
              _this.log(error.message, { color: 'red' });
              reject(error);
            }
          );
        });
      },

      _fetchRevisionManifest: function() {
        var manifestPath = this.readConfig('revisionManifest');
        var client = this._client;
        var _this = this;

        return new Promise(function(resolve, reject) {
          client.readFile(manifestPath).then(
            function(manifest) {
              _this.log('fetched manifest ' + manifestPath, { verbose: true });

              resolve(JSON.parse(manifest));
            },
            function(error) {
              if (error.message === 'No such file') {
                _this.log('Revision manifest not present building new one.', { verbose: true });

                resolve([ ]);
              } else {
                _this.log(error.message, { color: 'red' });
                reject(error);
              }
            }
          );
        });
      },

      _rsync: function (destination) {
         var _this = this;
         var rsync = new Rsync()
           .shell('ssh -p ' + this.readConfig('port'))
           .flags(this.readConfig('rsyncFlags'))
           .source(this.readConfig('directory'))
           .destination(destination);

         if (this.readConfig('exclude')) {
           rsync.set('exclude', this.readConfig('exclude'));
         }

         if (this.readConfig('displayCommands')) {
           this.log(rsync.command());
         }

         rsync.execute(function() {
           _this.log('Done !');
         });
       },
    });

    return new DeployPlugin();
  }
};
